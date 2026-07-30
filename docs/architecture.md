# GATHRA architecture

## System boundary

```text
Android app
  |
  | normalized HTTP/JSON :3000
  v
NestJS
  |-- FloodHazardProvider --+-> GraphHopper custom model :8989
  |                         `-> independent route/polygon evaluation
  |-- read-only flood GeoJSON endpoint
  `-- Geocoding provider --> Pelias API :4000
                               |-- Elasticsearch :9200
                               |-- Placeholder :4100
                               |-- PIP :4200
                               `-- libpostal :4400
```

Only NestJS publishes a host port. Provider ports are Compose-internal.

## Android

The app is a single Gradle module under package
`opsi.sman35jkt.gathra`. `GathraApplication` creates an application-scoped
`AppContainer`; no DI framework is used.

### Layers

- `core/model`: framework-independent `GeoPoint`, route, manoeuvre, selection,
  and place models.
- `core/location`, `core/map`, `core/navigation`: stable platform/map
  abstractions and shared helpers.
- `domain/route`: `RouteRepository`.
- `domain/flood`: `FloodHazardRepository`.
- `domain/geocoding`: `GeocodingRepository`.
- `domain/navigation`: `NavigationRepository`, session/progress/status models,
  and the explicit state machine.
- `data/route`: deterministic fake and Retrofit remote implementations.
- `data/flood`: deterministic fake and strict Retrofit/GeoJSON mapping.
- `data/geocoding`: deterministic fake and Retrofit remote implementations;
  DTO mapping stays here.
- `data/location`: one-shot foreground location, fused navigation updates, and
  deterministic simulated updates.
- `data/navigation`: geometry projection, progress, deviation, reroute,
  filtering, voice policy, and the application-scoped session engine.
- `feature/map`, `feature/geocoding`, `feature/navigation`: immutable UI state,
  typed actions/effects, ViewModels, and Compose surfaces.
- `service/navigation`: foreground service, notification, controller, and TTS
  manager.

### State and lifecycle

`MapRouteViewModel` owns route-preview state. It cancels stale route requests,
supports permission-denied fallback, and reverse-geocodes selected map points
asynchronously. Reverse results modify labels only. Flood polling is not
started by construction: `ScreenStarted` creates one idempotent polling job and
`ScreenStopped` cancels polling/fetch/debounce work. The last successful
snapshot remains available and is explicitly marked stale after refresh
failure or lifecycle stop.

The selected route and visible polygons synchronize by immutable snapshot ID.
A mismatch enters `OUTDATED_BY_FLOOD_UPDATE`, then a debounced,
generation-protected request enters `UPDATING`. Only a response evaluated
against the target snapshot may replace the route. Failure retains the old
geometry as stale guidance, removes any current LOW implication, and exposes a
retry. The same visible snapshot is sent to the active navigation foreground
service, which reuses its guarded reroute path with a cooldown. A newer target
snapshot immediately invalidates an older in-flight flood reroute; both
generation and target-snapshot checks prevent a late response from replacing
newer guidance.

`PlaceSearchViewModel` keeps the query across Activity recreation, requires
three characters for autocomplete, debounces about 400 ms, uses
`flatMapLatest`, and applies generation checks so old responses cannot replace
new results. Outside-region suggestions are disabled.

`NavigationSessionEngine` and `NavigationSessionRepository` own active
navigation beyond an Activity instance. The foreground service starts
high-accuracy updates only during an active session and stops location/TTS/
reroute work on stop or arrival. Process-death persistence is intentionally
limited.

MapLibre Android view instances are retained across Compose recomposition.
Routes and markers use map sources/layers rather than many Android view
markers.

### Important models and contracts

- `GeoPoint`: latitude/longitude, independent of GeoJSON/MapLibre.
- `TravelMode`: CAR or MOTORCYCLE.
- `RouteRequest`, `RouteOption`, `RouteGeometry`, `RouteSummary`.
- `RouteStep`, `RouteManeuver`, `ManeuverType`, `ManeuverModifier`.
- `RouteSelectionPoint`: coordinate, source, and optional display metadata.
- `PlaceSuggestion`, `SelectedPlace`, `PlaceCategory`.
- `FloodHazardSnapshot`, `FloodHazardPolygon`, `RouteFloodRisk`.
- `NavigationSession`, `NavigationProgress`, `NavigationStatus`,
  `NavigationLocation`.
- `RouteRepository.getRoutes`.
- `GeocodingRepository.autocomplete/search/lookup/reverse`.
- `NavigationRepository.session/prepare/setMuted/finish`.

## NestJS

`AppModule` contains four provider-neutral surfaces:

- `routes`: validation/controller/service plus `GraphHopperClient`; only
  independently evaluated non-blocked routes are returned.
- `flood`: the simulation-only `FloodHazardProvider`, read-only GeoJSON API,
  optional development mutation controller, configured limits, and independent
  route evaluator.
- `geocoding`: controller/service/provider token, fake/Pelias adapters,
  response mapper, bounded TTL cache, concurrency limiter, rate guard,
  supported-region classifier, and signed opaque place tokens.
- `health`: readiness for both selected providers.

Global bootstrap provides URI versioning (`/api/v1`), strict DTO validation,
request IDs, a common sanitized error envelope, and OpenAPI.

### GraphHopper

GraphHopper 11.0 is built from `backend/routing-engine/` and reads the PBF/XML
mounted as `/data/region.osm`. It has explicit `car` and `motorcycle` profiles.
The client asks for GeoJSON points and instructions, validates snapped
endpoints and geometry, maps provider signs to framework-independent
manoeuvres, and ensures ordered intervals ending with `ARRIVE`.

Routes never expose GraphHopper response types. The Android remote repository
maps normalized DTOs into domain models.

Flood polygons are converted to request-scoped GraphHopper custom-model areas.
LOW, MEDIUM, HIGH, and BLOCKED priority multipliers remain `0.8`, `0.35`,
`0.05`, and `0.0`; custom models require `ch.disable=true`. NestJS then checks
the returned LineStrings independently. If all returned routes intersect a
BLOCKED polygon, it returns `NO_ROUTE_DUE_TO_FLOOD` instead of recommending a
blocked route. Hazard snapshots are in-memory and not production durable.

### Geocoding

`GeocodingProvider` defines autocomplete, search, lookup, reverse, and health.
`FakeGeocodingProvider` is the backend default. `PeliasGeocodingProvider` is
selected by configuration and constrains searches to Indonesia plus the
versioned buffered bounds.

Pelias GIDs are never returned directly. NestJS issues signed opaque tokens
for lookup. Normal logs contain request IDs, duration, count, and query length,
not full address-like queries. Reverse responses preserve the requested
coordinate.

## Docker Compose

Always-on services:

- `routing-engine`
- `backend`

Runtime profile `geocoding`:

- `pelias-elasticsearch`
- `pelias-libpostal`
- `pelias-placeholder`
- `pelias-pip`
- `pelias-api`

Explicit profile `geocoding-import`:

- `pelias-schema`
- `pelias-wof-download`
- `pelias-wof-import`
- `pelias-placeholder-prepare`
- `pelias-osm-import`
- `pelias-csv-import`
- `pelias-api-candidate`
- `pelias-quality`

Persistent volumes are `graphhopper-cache` and
`pelias-elasticsearch-data`. `geocoding-private` is internal;
`geocoding-download` grants egress only to data-download jobs.

Candidate index names follow `gathra-geocoder-vYYYYMMDDHHMM[SS]`.
`gathra-geocoder-read` is the stable read alias. Rebuild scripts create a new
candidate, import, test, switch the alias atomically, and retain the previous
index. Deletion requires the physical index name twice and refuses the live
alias target.

## Architectural constraints

- No provider SDK/type may cross a domain boundary.
- No direct Android access to GraphHopper/Pelias/Elasticsearch.
- No background-location permission or raw location-history persistence.
- No network/geocoding calls from Composables.
- No production secret in source or BuildConfig.
- No normal startup import/index rebuild.
- No hosted geocoder fallback.
- Flood data is simulated and in-memory: no database, sensor ingestion,
  authentication, multi-instance consistency, traffic, or telemetry.
- Development flood mutation endpoints are unauthenticated and disabled by
  default; local opt-in must never be exposed publicly.
