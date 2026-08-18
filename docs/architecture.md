# GATHRA architecture

## System boundary

```text
Android app
  |
  | normalized HTTP/JSON
  v
NestJS
  |-- Route service -------> GraphHopper 11.0
  |      `---------------> independent flood geometry evaluation
  |-- Geocoding provider --> Photon 0.5.0
  |-- Flood provider ------> simulated in-memory snapshots
  |-- IoT ingestion -------> PostgreSQL 17 raw telemetry
  |-- IoT monitoring -----> bounded public read-only queries
  `-- Health -------------> routing + geocoding + PostgreSQL readiness
```

The deployed client path adds HTTPS and Cloudflare Tunnel before NestJS.
GraphHopper and Photon remain private. Local Compose publishes only NestJS port
3000; its geocoding provider network is internal.

## Android application

The native app is a single Gradle application module under package
`opsi.sman35jkt.gathra`. `GathraApplication` owns one application-scoped manual
`AppContainer`; no dependency-injection framework is used.

The only application variants are `debug` and `release`. Both construct remote
routing, geocoding, and flood repositories against one shared NestJS base URL,
plus the fused foreground navigation location source. Deterministic fakes are
test-source fixtures and are not packaged into either variant.

### Layers

- `core/model`: framework-independent coordinates, routes, manoeuvres, places,
  selection metadata, and flood models.
- `core/location`, `core/map`, `core/navigation`: stable platform/map
  abstractions and shared navigation helpers.
- `domain/route`: provider-neutral `RouteRepository`.
- `domain/geocoding`: provider-neutral `GeocodingRepository`.
- `domain/flood`: provider-neutral `FloodHazardRepository`.
- `domain/navigation`: navigation repository, session/progress/status models,
  and explicit state transitions.
- `data/route/remote`: Retrofit API, strict DTO mapping, and remote repository.
- `data/geocoding/remote`: Retrofit API, normalized DTO mapping, and remote
  repository.
- `data/flood/remote`: Retrofit/GeoJSON API, strict snapshot mapping, and remote
  repository.
- `data/location`: one-shot foreground location and fused active-navigation
  updates.
- `data/navigation`: geometry projection, progress, deviation, filtering,
  reroute coordination, voice policy, and the application-scoped session
  engine.
- `feature/map`, `feature/geocoding`, `feature/navigation`: immutable UI state,
  typed actions/effects, ViewModels, and Compose surfaces.
- `service/navigation`: foreground service, notification, controller, and TTS
  lifecycle.

Retrofit DTOs, Android Location, and MapLibre objects never enter Android
domain or UI state.

### Preview, search, and coordinate authority

`MapRouteViewModel` owns route-preview state. It cancels stale requests,
supports permission-denied fallback behavior, and reverse-geocodes selected
map points asynchronously. A map-selected `GeoPoint` is authoritative;
reverse results may change labels only.

`PlaceSearchViewModel` retains its query across Activity recreation, applies a
minimum query length and debounce, and uses cancellation plus generation checks
so stale responses cannot replace newer results. Suggestions outside configured
coverage are visible but not selectable. Manual map selection remains available
when geocoding fails.

### Navigation ownership

`NavigationSessionRepository` retains the active session beyond one Activity
instance. `NavigationForegroundService` owns high-accuracy location
collection, rerouting, notification updates, and TTS while navigation is
active. `NavigationSessionEngine` performs route projection, progress,
off-route detection, guarded reroutes, and cleanup.

The app requests foreground location only. Location updates, reroute jobs, and
voice work stop on navigation stop or arrival. Process-death recovery is
limited because the session is not stored in a durable database.

MapLibre Android views are retained across Compose recomposition. Route,
marker, and flood geometry use owned map sources and layers rather than large
sets of Android view markers.

## NestJS application

NestJS exposes five provider-neutral areas:

- `routes`: strict request validation, normalized response mapping,
  GraphHopper client, flood-aware filtering, and error contracts.
- `geocoding`: autocomplete/search/lookup/reverse, provider adapter, bounded
  caches, concurrency/rate guards, regional policy, and opaque tokens.
- `flood`: read-only active GeoJSON snapshots, optional local development
  mutations, and an independently enabled bearer-authenticated administration
  controller.
- `health`: readiness for both selected providers and PostgreSQL.
- `iot`: Gateway-authenticated raw packet batches, independent Protocol v1
  decoding, PostgreSQL repositories, and public read-only Node monitoring.

## IoT persistence boundary

Gateway ingestion and monitoring are isolated under `src/iot`; they do not call
`RoutesService` or `FloodHazardProvider`. Exact raw LoRa packets are stored with
decoded measurement columns and reception metadata. The stable physical key is
Gateway hardware MAC; editable logical Gateway ID is retained as a telemetry
snapshot. Node measurement identity is enforced by the PostgreSQL unique key
`(node_id, node_boot_session_id, node_sequence)`.

The Gateway Bearer token is compared through SHA-256 and constant-time digest
comparison. Only its digest is configured server-side. Monitoring endpoints do
not use that credential and return frontend-oriented measurement/reception
objects with unavailable values as JSON `null`. A validated exact-origin CORS
allowlist permits read-only browser access from the future GATHRA website.

SQL migrations in `database/migrations` execute once under an advisory lock at
application bootstrap. PostgreSQL is mandatory for Backend readiness. Raw
history is not automatically deleted or downsampled in v1.

URI versioning creates `/api/v1`. Global DTO validation rejects unknown input.
Request IDs and a sanitized common error envelope are applied across APIs.
OpenAPI is configured at `/api/docs` and `/api/docs-json`.

## GraphHopper boundary

GraphHopper 11.0 reads the OSM file mounted as `/data/region.osm` and maintains
its generated graph in a named cache. The checked-in fixture is intentionally
small; useful geographic routing coverage depends on the configured PBF.

The provider defines `car` and `motorcycle` profiles. The NestJS client asks
for GeoJSON geometry and instructions, validates snapped endpoints and
geometry, maps provider signs into GATHRA manoeuvre/modifier enums, and
constructs ordered step intervals ending in `ARRIVE`.

GraphHopper response types never leave the backend. Route IDs are normalized
opaque fingerprints rather than provider identifiers.

## Photon boundary

`GeocodingProvider` defines autocomplete, search, lookup, reverse, and health.
Photon is the normal Compose implementation; a fake provider remains available
inside the backend for deterministic backend tests and local development.

NestJS constrains Photon queries to the versioned buffered bounds over the
pinned Indonesia database. Direct provider IDs are not returned. NestJS signs
opaque place tokens and stores normalized details in a bounded TTL cache
because Photon has no lookup-by-OSM-ID endpoint. Reverse responses preserve the
requested coordinate.

Normal logs contain request IDs, durations, counts, and query lengths, not full
address-like queries or result text.

## Flood snapshot flow

The current `FloodHazardProvider` is simulated, in-memory, and local to one
NestJS process. The read-only GeoJSON endpoint is always registered;
unauthenticated mutation endpoints require an explicit local opt-in. The
authenticated administration controller, public read controller, and route
service all resolve the same singleton provider when administration is
enabled, so one process has one coherent snapshot. Each process adds a random
instance identity to snapshot IDs so a restart cannot reuse the previous
process's initial identifiers.

Administration fails closed: both an explicit enable flag and a valid SHA-256
token digest are required at startup. The controller compares bearer-token
digests without embedding the raw token, emits metadata-only mutation audit
events, sends non-cacheable responses, and is excluded from OpenAPI. The raw
token and deployment routing remain external operational state.

For each preview request:

1. NestJS captures one immutable active-hazard snapshot.
2. Flood polygons become request-scoped GraphHopper custom-model areas.
3. GraphHopper returns route candidates.
4. NestJS independently intersects every LineString with the same snapshot.
5. Routes touching a `BLOCKED` polygon are rejected; usable routes are ranked
   and exactly one is recommended.
6. Route-risk metadata records the snapshot used for evaluation.

Android polls the read-only snapshot only while its UI lifecycle is started.
A selected route is current only when its risk snapshot matches the visible
snapshot:

```text
SYNCHRONIZED
  -> OUTDATED_BY_FLOOD_UPDATE
  -> UPDATING
  -> SYNCHRONIZED (replacement matches target)
  -> STALE       (refresh/recalculation fails or mismatches)
```

Preview and navigation retain old geometry during validation but do not present
its old risk as current. Generation and target-snapshot checks prevent late
responses from replacing newer guidance. Active navigation reuses its guarded
foreground-service reroute flow.

Flood snapshots still have no database, durable history, multi-instance
consistency, sensor conversion, or real-time push invalidation. PostgreSQL IoT
telemetry is deliberately separate and is not a `FloodHazard` data source yet.

## Deployment boundary

The repository defines the development Compose topology. The deployed service
uses the same provider boundaries behind `https://api.gathra.my.id/`, but
server paths, Cloudflare credentials, backups, and update/rollback scripts are
external operational state.

Committing to `main` does not deploy automatically. Android release signing and
distribution are also outside the repository's current build quality gate.

## Architectural constraints

- Android calls NestJS only; provider SDKs and hostnames remain server-side.
- Domain models remain provider- and framework-neutral.
- GeoJSON is `[longitude, latitude]`; Android `GeoPoint` is latitude then
  longitude.
- Map selection coordinates remain authoritative.
- No background-location permission or raw location-history persistence.
- No network/geocoding calls from Composables.
- No production secrets in source, Gradle properties, or BuildConfig.
- No automatic provider-data download, import, replacement, or deletion.
- No hosted geocoder fallback.
- Missing, stale, or simulated flood data is never a safety guarantee.
