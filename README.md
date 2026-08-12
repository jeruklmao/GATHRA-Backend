# GATHRA Backend

The NestJS backend owns GATHRA's normalized routing, geocoding, health, and
simulated flood-hazard contracts. Android calls this service only; GraphHopper
and Photon remain private implementation providers.

The deployed public base URL is `https://api.gathra.my.id/`. Local Docker
Compose publishes NestJS on port 3000 by default.

```text
Android/client -> NestJS :3000 -> GraphHopper 11.0 :8989 (private)
                            |---> Photon 0.5.0 :2322 (private)
                            `---> in-memory FloodHazardProvider
```

Flood data is simulation-only and lost on restart. Local development mutation
tools are unauthenticated; a separate fail-closed administration surface uses
a high-entropy bearer token when explicitly enabled. The backend has no
database, real sensor ingestion, user accounts, traffic, telemetry, or active
navigation-session logic.

## Prerequisites

- Docker Engine and Docker Compose v2.
- `curl`, `jq`, `tar`, and `md5sum` for provider setup and smoke checks.
- Node.js `>=20.11 <25` and npm for host-side quality checks.
- A deliberately installed Photon data volume for the normal Compose mode.

Copy `.env.example` to `.env` only when overriding defaults.
Never commit `.env` or a token-secret value.

## Local stack

Install Photon data once as described below, then start the complete stack from
the repository root:

```bash
docker compose up --build --wait
geocoding/scripts/health-check.sh
```

Stop containers while preserving named volumes:

```bash
docker compose down
```

For deterministic backend work that does not query Photon:

```bash
GEOCODING_PROVIDER=fake \
docker compose up --build --wait
```

Photon remains part of the Compose topology but is not selected by NestJS in
that mode. Android has no corresponding fake runtime mode.

The complete routing smoke script starts the stack and tears down containers
without deleting named data volumes:

```bash
scripts/compose-health-check.sh
```

## Configuration

Checked-in defaults live in `.env.example`, `compose.yaml`, and
`src/configuration.ts`.

| Area | Variables |
| --- | --- |
| NestJS | `GATHRA_BACKEND_PORT` (Compose host port), `PORT` (process port) |
| Routing | `GATHRA_OSM_FILE`, `ROUTING_ENGINE_BASE_URL`, `ROUTING_ENGINE_TIMEOUT_MS`, `GRAPH_HOPPER_JAVA_OPTS`, `GRAPH_HOPPER_MIN_NETWORK_SIZE` |
| Geocoding provider | `GEOCODING_PROVIDER`, `PHOTON_BASE_URL`, `GEOCODING_PROVIDER_TIMEOUT_MS` |
| Geocoding limits | `GEOCODING_MAX_CONCURRENCY`, `GEOCODING_MAX_QUEUE_SIZE`, `GEOCODING_RATE_LIMIT`, `GEOCODING_RATE_WINDOW_MS` |
| Geocoding cache | `GEOCODING_CACHE_ENTRIES`, `GEOCODING_CACHE_TTL_MS`, `GEOCODING_REVERSE_CACHE_TTL_MS` |
| Geocoding policy | `GEOCODING_TOKEN_SECRET`, `GEOCODING_REGION_CONFIG`, `GEOCODING_REGION_VERSION`, optional region-bound overrides |
| Photon runtime/data | `PHOTON_JAVA_OPTS`, `PHOTON_MEMORY_LIMIT`, `PHOTON_CPUS`, `PHOTON_DATA_URL`, `PHOTON_DATA_MD5`, `PHOTON_DATA_VOLUME` |
| Flood simulation | `ENABLE_DEV_FLOOD_ENDPOINTS`, `ENABLE_FLOOD_ADMIN_ENDPOINTS`, `FLOOD_ADMIN_TOKEN_SHA256`, `MAX_ACTIVE_FLOOD_HAZARDS`, `MAX_FLOOD_POLYGON_VERTICES` |

`GEOCODING_TOKEN_SECRET` is a deployment secret. Source code contains a safe
development fallback, but a stable deployment value must remain outside Git.

## Normalized API

URI versioning produces these current v1 endpoints:

- `POST /api/v1/routes/preview`
- `GET /api/v1/geocoding/autocomplete`
- `GET /api/v1/geocoding/search`
- `GET /api/v1/geocoding/places/:id`
- `GET /api/v1/geocoding/reverse`
- `GET /api/v1/flood-hazards`
- `GET /api/v1/health`

Development flood endpoints under `/api/v1/dev/flood-hazards` exist only when
`ENABLE_DEV_FLOOD_ENDPOINTS=true` at application startup. The separate
`/api/v1/admin/flood-hazards` surface exists only when
`ENABLE_FLOOD_ADMIN_ENDPOINTS=true` and a valid token digest is configured.
It is intentionally omitted from OpenAPI.

OpenAPI is available at `/api/docs` and `/api/docs-json`. Those paths are also
currently reachable on the public deployment because Swagger is configured
unconditionally in `src/app-bootstrap.ts`.

### Route preview

`alternatives` is the number of extra routes and must be `0` or `1`.
`travelMode` is `CAR` or `MOTORCYCLE`.

```json
{
  "origin": { "latitude": -6.1939, "longitude": 106.8250 },
  "destination": { "latitude": -6.2124, "longitude": 106.8094 },
  "travelMode": "CAR",
  "alternatives": 1
}
```

Responses contain normalized route geometry, summary, manoeuvre steps, and
flood-risk metadata. GeoJSON coordinate order is `[longitude, latitude]`.
Provider response types and GraphHopper signs never cross the NestJS contract.

GraphHopper receives request-scoped flood areas through a custom model. NestJS
then evaluates returned LineStrings independently. Routes intersecting a
`BLOCKED` polygon are excluded; if none remain, the API returns
`NO_ROUTE_DUE_TO_FLOOD`. Origins and destinations in blocked areas use distinct
error codes.

### Geocoding

Autocomplete and search return normalized suggestions plus opaque NestJS-issued
place tokens. Clients must not construct Photon or OSM identifiers. Photon has
no lookup-by-OSM-ID API, so NestJS resolves tokens through its bounded details
cache. An expired token is recoverable by repeating the search.

Reverse geocoding preserves the exact requested coordinate. Provider names,
addresses, and coordinates are display metadata only.

### Health

`GET /api/v1/health` is readiness, not process-only liveness. It returns 200
only when both the configured routing and geocoding providers are available.

## GraphHopper routing data

The checked-in `routing-engine/fixtures/jakarta-sample.osm` is a tiny synthetic
graph for deterministic smoke checks, not city coverage.

For a broader Jakarta–Tangerang development graph, prepare an OSM extract for
this routing envelope (longitude/latitude):

```text
106.52,-6.40,106.90,-6.06
```

One reproducible workflow is:

```bash
sudo dnf install osmium-tool
mkdir -p routing-data
curl --fail --location --retry 3 \
  --output routing-data/java-latest.osm.pbf \
  https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf
osmium extract \
  --bbox=106.52,-6.40,106.90,-6.06 \
  --strategy=complete_ways \
  --set-bounds \
  routing-data/java-latest.osm.pbf \
  --output routing-data/gathra-jakarta-tangerang.osm.pbf
osmium tags-filter \
  routing-data/gathra-jakarta-tangerang.osm.pbf \
  nw/highway r/type=restriction \
  --output routing-data/gathra-jakarta-tangerang-routing.osm.pbf
osmium check-refs \
  routing-data/gathra-jakarta-tangerang-routing.osm.pbf
```

Set `GATHRA_OSM_FILE` to the routing-only PBF and use an appropriate Java heap.
For a regional graph, set `GRAPH_HOPPER_MIN_NETWORK_SIZE=200`; the tiny fixture
requires `0`.

Changing OSM input, routing profiles, or the subnetwork threshold requires a
new graph. Resolve and remove only the exact `graphhopper-cache` volume when
that replacement is intentional. MOTORCYCLE uses GraphHopper's built-in model
and has not been calibrated for Indonesian access rules or travel times.

## Photon data and regional policy

The pinned Indonesia database is:

```text
URL: https://download1.graphhopper.com/public/extracts/by-country-code/id/photon-db-id-250720.tar.bz2
MD5: 0e027552ff841b12a2c703cf290daad2
```

Initial installation is explicit:

```bash
geocoding/scripts/download-photon-data.sh
```

The script downloads over HTTPS, verifies the pinned checksum, rejects unsafe
archive paths, validates the index layout, and refuses to overwrite a non-empty
volume. The default external volume is `gathra-routing_photon-data`; Compose
cannot delete it through `down -v`.

Photon 0.5.0 does not support the newer `countrycode` parameter. NestJS sends
the configured buffered bounding box. The pinned database does not expose an
Indonesian language analyzer, so Indonesian requests use local/default labels.

### Safe update and rollback

Never unpack a candidate over the active database.

1. Choose a new empty candidate volume and a compatible, verified dump.
2. Install into that exact volume:

   ```bash
   PHOTON_DATA_VOLUME=gathra-routing-photon-candidate \
   PHOTON_DATA_URL=<verified-https-url> \
   PHOTON_DATA_MD5=<verified-checksum> \
   geocoding/scripts/download-photon-data.sh
   ```

3. Start Compose with the same `PHOTON_DATA_VOLUME`.
4. Run health plus normalized and raw-Photon quality checks.
5. Keep the previous volume unchanged until the candidate is accepted.
6. Roll back by restoring the previous volume name and restarting Compose.

Old-volume deletion is deliberately manual. Resolve the exact volume with
`docker volume inspect` and confirm rollback is no longer needed first.

### Coverage source of truth

`geocoding/region/region-config.json` defines an 8 km buffered envelope around:

- Jakarta Pusat — OSM relation 7625977
- Jakarta Selatan — OSM relation 5802438
- Kota Tangerang — OSM relation 7641583
- Kota Tangerang Selatan — OSM relation 7641582

The configured envelope is larger than the four administrative polygons. A
buffer point may be serviceable without belonging to one of those cities.
`supported-region.geojson` records the service rectangle, while
`administrative-boundaries.geojson` contains the actual relations used by the
quality runner.

The relation source pattern is
`https://www.openstreetmap.org/relation/<relation-id>`. Regenerate relation
geometry from a pinned regional PBF with:

```bash
osmium getid -r -t regional-source.osm.pbf \
  r7625977 r5802438 r7641583 r7641582 \
  -o administrative-boundaries.osm.pbf
osmium export administrative-boundaries.osm.pbf -f geojsonseq
```

When regional policy changes, update the versioned config, relation snapshot,
actual polygons, bounds, supported-region GeoJSON, routing extract, and quality
corpus together. Verify the selected Photon dump still covers the result.

### Quality corpus and custom POI fixture

Run the normalized contract gate first:

```bash
geocoding/scripts/run-quality-tests.sh
```

Then inspect provider ranking without publishing Photon:

```bash
geocoding/scripts/run-quality-tests.sh --raw-photon
```

The committed corpus is source-derived regression smoke data, not an
independently verified address register. `SOURCE_DERIVED` proves traceability
to its recorded OSM snapshot, not institutional or field validation. Requiring
independently verified cases intentionally fails until the corpus is promoted:

```bash
GEOCODING_QUALITY_REQUIRE_VERIFIED=true \
  geocoding/scripts/run-quality-tests.sh
```

`geocoding/custom-poi/gathra-poi.csv` is a public-OSM-derived schema fixture.
The lightweight Photon deployment does not import it. Do not add confidential
locations, private home addresses, credentials, or unverified emergency data.
Before adding a fixture row, verify the public name and coordinate, use a
stable project-owned ID, retain `source=gathra` and `layer=venue`, record
aliases and dataset/version metadata in the existing JSON fields, review
redistribution/attribution terms, and add a verified corpus case when the
fixture participates in testing. A real custom-POI import pipeline requires
separate design and validation.

## Local flood simulation

The read-only endpoint is always available. Mutation tools fail closed in
source, `.env.example`, and Compose. Enable them only on an isolated local
machine:

```bash
ENABLE_DEV_FLOOD_ENDPOINTS=true \
docker compose up --build --wait
```

Useful local presets are:

```bash
curl --fail --request DELETE \
  http://127.0.0.1:3000/api/v1/dev/flood-hazards
curl --fail --request POST \
  http://127.0.0.1:3000/api/v1/dev/flood-hazards/presets/central-corridor-high
curl --fail --request POST \
  http://127.0.0.1:3000/api/v1/dev/flood-hazards/presets/central-corridor-blocked
```

Each mutation advances the in-memory snapshot. Never expose an opt-in stack to
an untrusted network, and never present its data as a safety guarantee.

## Authenticated flood administration

The administration controller mutates the same singleton provider used by the
public read and route-preview endpoints in that NestJS process. It is disabled
by default and startup fails if it is enabled without a 64-character
hexadecimal SHA-256 digest in `FLOOD_ADMIN_TOKEN_SHA256`.

Generate a 256-bit hexadecimal bearer token into a mode-600 file outside Git,
then configure only its digest in the deployment environment. Do not put the
raw token in Compose, shell history, source control, logs, or chat. Requests use
`Authorization: Bearer <token>`; missing and incorrect credentials receive a
generic HTTP 401 response. Use an operations script that reads the token file
without printing it.

The authenticated surface supports listing, adding, deleting, clearing, and
activating the `central-corridor-high` or `central-corridor-blocked` presets.
It is authentication for a simulation tool, not authorization for multiple
users and not a public-safety data source. State remains per-process and is
lost whenever the backend restarts.

## Quality checks

```bash
npm ci
npm run build
npm run test:unit
npm run test:integration
npm audit --omit=dev
```

Unit and integration tests use provider doubles where needed; they do not
require GraphHopper or Photon network access.

## Production constraints and attribution

- The current public endpoint uses HTTPS and keeps GraphHopper and Photon
  private.
- Development flood mutation routes are not available publicly.
- Authenticated flood administration is fail-closed, hidden from OpenAPI, and
  uses only a token digest in the process environment; the raw token remains
  external deployment state.
- Public Swagger is an observed current exposure, not an authentication layer.
- The deployment is not a public-safety guarantee and repository changes do
  not deploy automatically.
- Provider indexes and routing graphs must be backed up and replaced through a
  reviewed operational process.
- Routing and Photon data are OpenStreetMap-derived. Preserve attribution and
  comply with the ODbL when distributing source or derived databases.
