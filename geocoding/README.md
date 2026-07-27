# GATHRA self-hosted Pelias pilot

This directory contains the limited-region Pelias deployment and explicit
import workflow for Jakarta Pusat, Jakarta Selatan, Kota Tangerang, and Kota
Tangerang Selatan. The configured 8 km buffer deliberately retains features
near borders. Android never talks to Pelias directly:

```text
Android -> NestJS :3000 -> Pelias API :4000 -> Elasticsearch
                                  |-> Placeholder
                                  |-> point-in-polygon service
                                  `-> libpostal service
```

Only NestJS publishes a host port. Elasticsearch, Pelias API, Placeholder,
point-in-polygon, and libpostal are attached to the Compose
`geocoding-private` internal network. The one-time Who's on First downloader is
the only Pelias job also attached to an egress-capable network.

## Components

Runtime profile `geocoding`:

- Elasticsearch 7.17 with a named data volume;
- Pelias API;
- Placeholder for administrative hierarchy text;
- Pelias point-in-polygon service;
- libpostal parsing service.

Explicit profile `geocoding-import`:

- Pelias schema/index creation;
- Who's on First Indonesia download and import;
- Placeholder data preparation;
- OpenStreetMap import;
- optional GATHRA CSV import;
- private candidate API and quality runner.

All Pelias images are official project images and are immutable by digest in
`../compose.yaml`. Tags remain visible only to identify their upstream release
line. Import jobs do not run during normal startup.

OpenStreetMap supplies roads, POIs, buildings, and mapped addresses. Who's on
First supplies administrative context. OpenAddresses is omitted: the upstream
Pelias OpenAddresses source tree had no Indonesian dataset when this pilot was
prepared, so adding the importer would consume resources without verified
coverage. Re-evaluate this decision when the source catalog changes.

## Host requirements

Recommended for a full local import while GraphHopper is also available:

- Fedora with Docker Engine and Compose v2;
- 8 CPU threads;
- 16 GiB RAM (12 GiB is a practical lower bound);
- at least 50 GiB free disk for source data, intermediate files, images, a
  candidate index, and the retained rollback index;
- `curl`, `jq`, `sha256sum`, and preferably `osmium-tool`.

Set Elasticsearch's required virtual-memory limit:

```bash
sudo sysctl -w vm.max_map_count=262144
echo 'vm.max_map_count=262144' |
  sudo tee /etc/sysctl.d/99-gathra-pelias.conf
```

The resource values in `.env.example` are starting limits, not observed
production sizing. On comparable developer hardware, budget roughly 8–12 GiB
active RAM for all geocoding services and several hours for the first download
plus import. Actual time and disk depend on the Java snapshot, storage, CPU,
and Docker cache; record measurements before production capacity planning.

## Region and data preparation

The versioned source of truth is `region/region-config.json`. The buffered
import polygon is `region/supported-region.geojson`; actual core-city polygons
used by quality preflight are in
`region/administrative-boundaries.geojson`. See `region/README.md` for relation
IDs and provenance.

From the repository root:

```bash
cp backend/.env.example backend/.env
sudo dnf install osmium-tool curl jq
backend/geocoding/scripts/download-data.sh
backend/geocoding/scripts/prepare-region-extract.sh
```

To use an existing pinned PBF instead of downloading Java again:

```bash
GATHRA_GEOCODING_SOURCE_PBF=/absolute/path/to/source.osm.pbf \
  backend/geocoding/scripts/prepare-region-extract.sh
```

Preparation produces:

- `gathra-supported-region.osm.pbf`: unfiltered input for Pelias;
- `gathra-supported-region-routing.osm.pbf`: highway/restriction subset for
  GraphHopper;
- SHA-256 files and an extract manifest.

This keeps geocoding and routing coverage aligned without starving Pelias of
addresses, buildings, or POIs. `--force` is required to replace an existing
extract.

## Candidate import and safe activation

Choose a new physical index name for every rebuild:

```bash
candidate="gathra-geocoder-v$(date -u +%Y%m%d%H%M)"
backend/geocoding/scripts/rebuild-index.sh \
  --candidate "${candidate}" \
  --yes
```

The orchestrator performs these explicit operations:

1. create the candidate schema;
2. download/import Indonesia administrative data when absent;
3. prepare Placeholder data;
4. import the regional OSM PBF;
5. import the safe custom CSV fixture;
6. start a private API against the candidate;
7. run source-derived raw-Pelias smoke checks;
8. atomically switch `gathra-geocoder-read` only after those checks pass.

It retains the old physical index and records the switch in
`data/rollback/last-switch.json`. It never deletes an index.

The steps can also be run individually:

```bash
backend/geocoding/scripts/initialize-index.sh "${candidate}"
backend/geocoding/scripts/import-wof.sh "${candidate}"
backend/geocoding/scripts/prepare-placeholder.sh
backend/geocoding/scripts/import-osm.sh "${candidate}"
backend/geocoding/scripts/import-custom-poi.sh "${candidate}"
backend/geocoding/scripts/run-quality-tests.sh --candidate "${candidate}"
backend/geocoding/scripts/switch-index-alias.sh "${candidate}"
```

## Runtime, health, and quality

Start the normalized API with real Pelias:

```bash
cd backend
GEOCODING_PROVIDER=pelias \
  docker compose --profile geocoding up --build -d --wait
cd ..
backend/geocoding/scripts/health-check.sh
backend/geocoding/scripts/run-quality-tests.sh
```

Smoke the API through NestJS, never through a host-exposed Pelias port:

```bash
curl --get 'http://127.0.0.1:3000/api/v1/geocoding/autocomplete' \
  --data-urlencode 'q=SMAN 35' \
  --data 'lat=-6.19' \
  --data 'lon=106.82'
curl --get 'http://127.0.0.1:3000/api/v1/geocoding/reverse' \
  --data 'lat=-6.1939' \
  --data 'lon=106.825'
```

The corpus is intentionally marked `SOURCE_DERIVED_SMOKE`. It verifies
regressions and reports ranking, reverse-label, coordinate-authority, coverage,
and latency metrics, but currently has zero independently verified acceptance
cases. See `quality/README.md`; do not report it as production geocoder
validation.

## Updating and rollback

For this pilot, schedule a deliberate source refresh every 1–4 weeks:

1. download a new source with `download-data.sh --force`;
2. run `prepare-region-extract.sh --force`;
3. create a newly named candidate;
4. import and run raw quality checks;
5. switch the alias;
6. run health and normalized quality checks;
7. keep the previous index until manual Android checks pass.

Rollback is an alias operation:

```bash
backend/geocoding/scripts/rollback-index.sh
```

Or specify a retained physical index:

```bash
backend/geocoding/scripts/rollback-index.sh \
  gathra-geocoder-v202607270900
```

Delete only after verification, with the exact name repeated:

```bash
backend/geocoding/scripts/delete-index.sh \
  --index gathra-geocoder-v202607270900 \
  --confirm gathra-geocoder-v202607270900
```

The deletion script refuses the live alias target. Deletion is irreversible
without a backup.

For pilot backup, preserve the source PBF/checksums, `pelias.json`, region
files, custom CSV, candidate name, and the Docker named Elasticsearch volume
with the operator's volume-backup tooling while Elasticsearch is stopped.
Restore that volume with the same pinned image, then verify cluster health,
alias targets, normalized API responses, and the corpus before serving it.
Elasticsearch snapshot-repository automation and full blue/green clusters are
not included in this milestone; retaining the prior index is the fast rollback
mechanism.

## Custom POIs

Edit `custom-poi/gathra-poi.csv` only with a documented, redistributable source.
Each row needs a stable ID, name, latitude, longitude, category, source,
dataset version/update date, and optional address/aliases. Then import it into
a new candidate with `import-custom-poi.sh`; never mutate the live index as the
normal update path. The committed rows are OSM-derived schema examples, not
authoritative emergency or shelter data.

## Fake mode and troubleshooting

Pelias is optional for ordinary deterministic development:

```bash
cd backend
GEOCODING_PROVIDER=fake docker compose up --build -d --wait
```

Common failures:

- Elasticsearch repeatedly restarts: verify `vm.max_map_count`, RAM, disk
  space, and `docker compose logs pelias-elasticsearch`.
- Placeholder/PIP is unhealthy: complete Who's on First import and
  `prepare-placeholder.sh`, then inspect its logs.
- OSM import cannot find the PBF: verify `GATHRA_GEOCODING_DATA_DIR` and run
  `prepare-region-extract.sh`.
- API returns `GEOCODER_UNAVAILABLE`: verify the `geocoding` profile is running,
  `GEOCODING_PROVIDER=pelias`, and use `health-check.sh`.
- Corpus receives HTTP 429: keep the local Compose rate limit at least as large
  as the committed corpus or run raw candidate checks; do not disable the
  application guard for a public deployment.
- A result is unexpectedly outside: compare the point with the buffered bounds
  and actual core polygons, then increment the region config version if policy
  changes.

Do not publish ports 9200, 4000, 4100, 4200, or 4400. Development diagnostics
should use `docker compose exec` on the private service.
