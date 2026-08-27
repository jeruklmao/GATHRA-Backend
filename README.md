# GATHRA Backend

The NestJS backend owns GATHRA's normalized routing, geocoding, health,
sensor-backed flood-hazard contracts, and PostgreSQL-backed IoT telemetry.
Android and future web clients call this service only; GraphHopper, Photon, and
PostgreSQL remain private implementation providers.

The deployed public base URL is `https://api.gathra.my.id/`. Local Docker
Compose publishes NestJS on port 3000 by default.

```text
Android/client -> NestJS :3000 -> GraphHopper 11.0 :8989 (private)
                            |---> Photon 0.5.0 :2322 (private)
                            |---> PostgreSQL 17 (private telemetry + sensor policy/state)
                            `---> SensorFloodHazardProvider
```

Production flood polygons and routing multipliers are derived from durable
Protocol 3 telemetry plus runtime PostgreSQL deployment configuration. The
in-memory provider remains available only for explicit simulation. A
fail-closed administration surface uses a high-entropy bearer token when
enabled. The backend has no user accounts, traffic, or active
navigation-session logic.

## Prerequisites

- Docker Engine and Docker Compose v2.
- PostgreSQL 17 is provided by Compose; a compatible external PostgreSQL may
  be used through `DATABASE_URL` for host development.
- `curl`, `jq`, `tar`, and `md5sum` for provider setup and smoke checks.
- Node.js `>=20.11 <25` and npm for host-side quality checks.
- A deliberately installed Photon data volume for the normal Compose mode.

Copy `.env.example` to `.env` only when overriding defaults. Generate a
development Gateway credential with `npm run iot:token`; provision the printed
raw token once and configure only its digest in the Backend. Never commit
`.env`, a database production password, or a raw token-secret value.

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
| PostgreSQL | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` (Compose), `DATABASE_URL` (NestJS) |
| IoT | `IOT_GATEWAY_TOKEN_SHA256`, `IOT_MAX_BATCH_SIZE` (1–50), `IOT_MONITOR_MAX_LIMIT` (1–1000), `IOT_MONITOR_ALLOWED_ORIGINS` |
| Routing | `GATHRA_OSM_FILE`, `ROUTING_ENGINE_BASE_URL`, `ROUTING_ENGINE_TIMEOUT_MS`, `GRAPH_HOPPER_JAVA_OPTS`, `GRAPH_HOPPER_MIN_NETWORK_SIZE` |
| Geocoding provider | `GEOCODING_PROVIDER`, `PHOTON_BASE_URL`, `GEOCODING_PROVIDER_TIMEOUT_MS` |
| Geocoding limits | `GEOCODING_MAX_CONCURRENCY`, `GEOCODING_MAX_QUEUE_SIZE`, `GEOCODING_RATE_LIMIT`, `GEOCODING_RATE_WINDOW_MS` |
| Geocoding cache | `GEOCODING_CACHE_ENTRIES`, `GEOCODING_CACHE_TTL_MS`, `GEOCODING_REVERSE_CACHE_TTL_MS` |
| Geocoding policy | `GEOCODING_TOKEN_SECRET`, `GEOCODING_REGION_CONFIG`, `GEOCODING_REGION_VERSION`, optional region-bound overrides |
| Photon runtime/data | `PHOTON_JAVA_OPTS`, `PHOTON_MEMORY_LIMIT`, `PHOTON_CPUS`, `PHOTON_DATA_URL`, `PHOTON_DATA_MD5`, `PHOTON_DATA_VOLUME` |
| Flood | `FLOOD_PROVIDER` (`sensor` or `in-memory`), `ENABLE_DEV_FLOOD_ENDPOINTS`, `ENABLE_FLOOD_ADMIN_ENDPOINTS`, `FLOOD_ADMIN_TOKEN_SHA256`, `MAX_ACTIVE_FLOOD_HAZARDS`, `MAX_FLOOD_POLYGON_VERTICES` |

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
- `GET /api/v1/admin/iot/sensor-deployments` (flood-admin Bearer authentication)
- `GET /api/v1/admin/iot/sensor-deployments/:nodeId` (flood-admin Bearer authentication)
- `PUT /api/v1/admin/iot/sensor-deployments/:nodeId` (flood-admin Bearer authentication)
- `POST /api/v1/iot/telemetry/batch` (Gateway Bearer authentication)
- `GET /api/v1/iot/gateway/ping` (Gateway Bearer authentication)
- `GET /api/v1/iot/nodes` (public read-only monitoring)
- `GET /api/v1/iot/nodes/:nodeId` (public read-only monitoring)
- `GET /api/v1/iot/nodes/:nodeId/telemetry` (public bounded history)
- `GET /api/v1/health`

Development flood endpoints under `/api/v1/dev/flood-hazards` exist only when
`FLOOD_PROVIDER=in-memory` and `ENABLE_DEV_FLOOD_ENDPOINTS=true` at startup.
The legacy `/api/v1/admin/flood-hazards` simulation surface is likewise
in-memory-only and omitted from OpenAPI. Durable sensor deployment endpoints
exist when `ENABLE_FLOOD_ADMIN_ENDPOINTS=true` with a valid token digest and
are documented in OpenAPI.

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

GraphHopper receives request-scoped flood areas and their runtime multipliers
through a custom model. NestJS then evaluates returned LineStrings
independently. Routes intersecting any multiplier-zero polygon are excluded;
if none remain, the API returns
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
only when the configured routing and geocoding providers and PostgreSQL are
available. The response reports each component independently.

### Raw IoT telemetry

Gateway ingestion accepts batches of exact Base64 LoRa payloads plus reception
metadata. NestJS independently validates and decodes Node Protocol v3 only,
stores the exact payload as `BYTEA`, normalizes unavailable sensor sentinels
and `referenceDistanceMm=0` to SQL `NULL`, and uses a hard unique constraint on
`(node_id, node_boot_session_id, node_sequence)`. A committed retry returns
`DUPLICATE`, so a lost HTTP response cannot create a second row.

The raw Gateway token is never stored by the Backend. Configure only a
64-character SHA-256 digest:

```bash
npm run iot:token
```

Migrations run at application bootstrap under a PostgreSQL advisory lock and
are recorded in `schema_migrations`. Inspect them with:

```bash
docker compose exec postgres psql -U "${POSTGRES_USER:-gathra}" \
  -d "${POSTGRES_DB:-gathra}" -c '\dt iot_*'
docker compose exec postgres psql -U "${POSTGRES_USER:-gathra}" \
  -d "${POSTGRES_DB:-gathra}" -c 'TABLE schema_migrations;'
```

Monitoring endpoints require no Gateway credential. History defaults to 200
rows, is capped by `IOT_MONITOR_MAX_LIMIT` (at most 1000), orders newest first,
and uses the trusted `serverReceivedAt` timeline. Browser CORS permits exact
origins in `IOT_MONITOR_ALLOWED_ORIGINS` (production default
`https://gathra.my.id`) for read-only methods. `includeRaw=true` opts into
Base64 payloads for debugging; ordinary chart requests stay compact.

See [docs/iot-telemetry.md](docs/iot-telemetry.md) for persistence and
ingestion operations, and
[docs/iot-monitoring-api.md](docs/iot-monitoring-api.md) for the future
`https://gathra.my.id/node` frontend contract. No frontend is implemented in
this repository. Sensor interpretation, freshness, administration, snapshots,
and routing semantics are documented in
[docs/sensor-flood-hazards.md](docs/sensor-flood-hazards.md).

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
FLOOD_PROVIDER=in-memory \
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

Administration is disabled by default and startup fails if it is enabled
without a 64-character hexadecimal SHA-256 digest in
`FLOOD_ADMIN_TOKEN_SHA256`. The same credential protects durable sensor
deployment GET/PUT endpoints. Simulation mutation endpoints are registered
only when `FLOOD_PROVIDER=in-memory`.

Generate a 256-bit hexadecimal bearer token into a mode-600 file outside Git,
then configure only its digest in the deployment environment. Do not put the
raw token in Compose, shell history, source control, logs, or chat. Requests use
`Authorization: Bearer <token>`; missing and incorrect credentials receive a
generic HTTP 401 response. Use an operations script that reads the token file
without printing it.

Sensor configuration survives Backend restarts and telemetry cleanup. A PUT
validates and persists the complete configuration, increments its material
version, and recomputes from stored telemetry atomically. Legacy preset tools
remain simulation-only and process-local.

## Production admin dashboard

Dashboard architecture, authentication, observer, metrics, safe configuration,
and operations are documented in [docs/admin-dashboard.md](docs/admin-dashboard.md).

## Quality checks

```bash
npm ci
npm run build
npm run test:unit
npm run test:integration
npm audit --omit=dev
```

The integration command starts an isolated real PostgreSQL service, runs
migrations plus all API regression tests, and tears it down. Provider doubles
avoid requiring GraphHopper or Photon network access during that suite.

## Production constraints and attribution

- The current public endpoint uses HTTPS and keeps GraphHopper and Photon
  private.
- Development flood mutation routes are not available publicly.
- Authenticated flood administration is fail-closed and uses only a token
  digest in the process environment; sensor deployment endpoints are in
  OpenAPI while the legacy simulation mutations remain hidden.
- Public Swagger is an observed current exposure, not an authentication layer.
- Gateway ingestion currently uses one static Bearer credential; public
  monitoring never exposes it.
- Raw telemetry is retained indefinitely in the current release. Define reviewed retention or
  downsampling before deployment scale makes that impractical; TimescaleDB is
  intentionally not introduced yet.
- Production Protocol 3 telemetry updates configured sensor flood state after
  raw persistence; derived failures never reject an otherwise valid raw row.
- The deployment is not a public-safety guarantee and repository changes do
  not deploy automatically.
- Provider indexes and routing graphs must be backed up and replaced through a
  reviewed operational process.
- Routing and Photon data are OpenStreetMap-derived. Preserve attribution and
  comply with the ODbL when distributing source or derived databases.
