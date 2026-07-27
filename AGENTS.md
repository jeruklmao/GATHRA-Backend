# GATHRA agent guide

Read [HANDOFF.md](HANDOFF.md), [docs/current-status.md](docs/current-status.md),
and [docs/architecture.md](docs/architecture.md) before changing code.

## Project intent

GATHRA is a native Indonesian Android route-preview and foreground
turn-by-turn navigation pilot. It uses MapLibre, a NestJS API, self-hosted
GraphHopper routing, and an in-progress self-hosted Pelias geocoder.

The geocoding pilot covers Jakarta Pusat, Jakarta Selatan, Kota Tangerang, and
Kota Tangerang Selatan, plus the versioned buffered envelope in
`backend/geocoding/region/region-config.json`. Do not spell Tangerang as
“Tanggerang” except in explicit typo-quality cases.

## Working rules

- Preserve the current dirty working tree. The geocoding milestone is
  implemented but uncommitted on `feature/geocoding`.
- Keep the Android app as one module with MVVM, immutable state, StateFlow,
  typed actions/effects, and the existing manual `AppContainer`. Do not add
  Hilt or split modules without discussion.
- Keep Android domain models independent of Retrofit DTOs, Android Location,
  MapLibre, GraphHopper, and Pelias types.
- Android must call NestJS only. Never expose GraphHopper, Pelias, or
  Elasticsearch directly to a device.
- A coordinate selected on the map is authoritative for routing. Reverse
  geocoding may replace display text only, never the coordinate.
- Keep manual map selection available even when geocoding fails.
- Preserve deterministic fake route/geocoding/location implementations for
  demo builds and tests.
- Request foreground location only. Do not add
  `ACCESS_BACKGROUND_LOCATION`.
- Keep active navigation execution in the foreground service/repository
  layer, not in Composables or an Activity.
- Keep all user-facing Android text in `strings.xml`, in Indonesian, and use
  Material theme tokens rather than screen-local colors.
- Keep provider images private on Compose networks. Only NestJS port 3000 may
  be published.
- Do not rebuild, switch, or delete Pelias indexes implicitly. Use the explicit
  candidate/quality/alias scripts and retain the previous index for rollback.
- Never commit API keys, tokens, generated graphs, PBF files, Elasticsearch
  data, or `.env`.

## Decisions requiring discussion before reversal

- MapLibre instead of Google Maps SDK.
- Self-hosted GraphHopper and Pelias behind a normalized NestJS contract.
- GeoJSON coordinate order is `[longitude, latitude]`; Android `GeoPoint`
  fields remain `latitude`, then `longitude`.
- `RouteRepository`, `GeocodingRepository`, and `NavigationRepository` are
  provider-neutral boundaries; DTOs never enter UI state.
- GraphHopper signs are normalized into GATHRA manoeuvre enums.
- `demo` uses fake routes, fake geocoding, and deterministic navigation
  simulation; `debug` uses remote repositories.
- Outside-geocoding-coverage suggestions are shown but cannot be selected.
- No database, accounts, flood logic, traffic, telemetry, MQTT, or hosted
  geocoding provider is part of the current baseline.

## High-risk files

- `app/src/main/java/opsi/sman35jkt/gathra/AppContainer.kt`: build-variant
  repository and navigation wiring.
- `app/src/main/java/opsi/sman35jkt/gathra/GathraApp.kt`: preview/search/
  navigation screen ownership.
- `feature/map/MapRouteViewModel.kt`: route cancellation, permissions,
  selection state, and reverse-geocode coordinate authority.
- `feature/geocoding/PlaceSearchViewModel.kt`: debounce and stale-response
  suppression.
- `core/map/MapLibreRouteMap.kt` and `MapLibreNavigationMap.kt`: Android view
  lifecycle and map-source/layer ownership.
- `data/navigation/NavigationSessionEngine.kt` and
  `service/navigation/NavigationForegroundService.kt`: location, reroute,
  TTS, and cleanup lifecycle.
- `backend/src/routes/graphhopper.client.ts`: provider response validation and
  navigation-step geometry intervals.
- `backend/src/geocoding/`: opaque tokens, private-query handling, regional
  policy, cache, and provider normalization.
- `backend/compose.yaml` and `backend/geocoding/scripts/`: private network,
  persistent data, index activation, and destructive operations.
- `app/build.gradle.kts` and `AndroidManifest.xml`: cleartext development,
  build flags, and foreground-service permissions.

## Verification commands

Use the Android Studio JBR on Fedora when no system JDK is configured:

```bash
JAVA_HOME=/opt/android-studio/jbr ./gradlew testDebugUnitTest
JAVA_HOME=/opt/android-studio/jbr ./gradlew lintDebug
JAVA_HOME=/opt/android-studio/jbr ./gradlew assembleDebug
JAVA_HOME=/opt/android-studio/jbr ./gradlew assembleDemo
JAVA_HOME=/opt/android-studio/jbr ./gradlew connectedDebugAndroidTest
```

Backend:

```bash
cd backend
npm ci
npm run build
npm run test:unit
npm run test:integration
```

Do not run full Pelias imports casually. Follow
`backend/geocoding/README.md`.

## Onboarding checklist

1. Confirm branch, hash, and dirty files with `git status --short --branch`.
2. Read this file, `HANDOFF.md`, `TODO.md`, and both files in `docs/`.
3. Inspect the existing diff before editing; do not overwrite the uncommitted
   geocoding milestone.
4. Verify which Android variant and backend provider mode are intended.
5. Use fake mode for fast deterministic work.
6. Before real Pelias work, obtain a complete source PBF and verify resources,
   checksums, region version, and rollback space.
7. Run focused tests first, then the full relevant verification matrix.

