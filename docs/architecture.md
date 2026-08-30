# GATHRA Backend architecture

## System boundary

```text
GATHRA Node
  -> LoRa Protocol 3
GATHRA Gateway
  -> authenticated Internet ingestion
GATHRA Backend
  -> PostgreSQL telemetry, sensor state, and flood classification
  -> GraphHopper routing and Photon geocoding
  -> public APIs
GATHRA Android
```

GATHRA Landing is a separate static Astro site and performs no browser-side
sensor or API polling.

## Service areas

- `iot` authenticates Gateway telemetry and heartbeat requests, independently
  decodes Protocol 3, persists immutable measurements, and exposes bounded
  public monitoring.
- `flood` combines telemetry with PostgreSQL sensor-deployment policy and
  exposes current GeoJSON coverage plus a sanitized sensor detail.
- `routes` sends request-scoped flood multipliers to GraphHopper, validates
  returned geometry, excludes multiplier-zero crossings, and ranks candidates.
- `geocoding` normalizes Photon autocomplete, search, lookup, and reverse
  results behind opaque Backend tokens and regional policy.
- `admin` serves the authenticated operator dashboard, configuration,
  observation, traffic, and bounded metrics surfaces.
- `health` checks GraphHopper, Photon, and PostgreSQL readiness.

URI versioning creates `/api/v1`; global validation rejects unknown request
fields. OpenAPI is served at `/api/docs` and `/api/docs-json`.

## Persistence

SQL migrations in `database/migrations` run transactionally under a PostgreSQL
advisory lock and are recorded in `schema_migrations`. The current migration set
is 001 through 007.

Telemetry stores exact Protocol 3 packets and decoded measurement/reception
columns. The uniqueness key is Node ID, persistent session, and sequence.
Sensor deployments hold runtime geometry, thresholds, hysteresis, freshness,
reference override, and multipliers. Sensor state is derived from immutable
telemetry and may be recomputed without rewriting the source row.

Gateway heartbeat ingestion updates one latest status row and appends one
compact metrics sample. Backend receipt time drives heartbeat freshness.
Heartbeat metrics have a 30-day cleanup policy; raw telemetry has no automatic
deletion or downsampling.

## Sensor state flow

```text
Protocol 3 TELEMETRY
  -> immutable iot_telemetry
  -> effective reference selection
  -> accepted-distance validation
  -> water-height classification and freshness
  -> iot_sensor_state
  -> flood polygon + routing multiplier + public sensor detail
```

The deployment reference override is authoritative when non-null; otherwise
the Node reference is used. A configuration write increments its material
version when needed and recomputes from stored telemetry in the same
transaction.

Every enabled deployment contributes its coverage polygon, including LOW,
UNKNOWN, STALE, and NO_TELEMETRY states. Snapshot IDs include deployment
version, current telemetry identity, effective level, and freshness, so a
material update changes the snapshot used by Android revalidation.

## Routing semantics

One flood snapshot is captured per preview request. Multipliers below 1 become
GraphHopper custom-model priority rules; multiplier 1 is a routing no-op.
NestJS independently intersects each returned LineString with the same
snapshot. Multiplier zero is a hard exclusion regardless of level name.

Usable routes are ordered by modeled flood score, duration, distance, and a
stable route ID. The selected route risk carries the exact snapshot ID used for
evaluation.

## Public and administrative boundaries

Android calls NestJS only. GraphHopper, Photon, PostgreSQL, raw Gateway
credentials, sensor administration, and infrastructure metrics remain
server-side.

`GET /api/v1/sensors/:nodeId` exposes only current user-level measurement and a
sanitized Gateway summary. Public IoT monitoring exposes bounded raw
observations for diagnostics. Flood-administrator routes use a separate bearer
credential, while the browser dashboard uses a secure cookie session plus CSRF
protection.

## Safety invariants

- GeoJSON uses `[longitude, latitude]`.
- `UNKNOWN`, `STALE`, and `NO_TELEMETRY` never imply LOW or safe.
- Multiplier zero is a hard routing exclusion at every risk label.
- Missing coverage does not establish flood-free conditions.
- Provider or snapshot failures must not present outdated guidance as current.
