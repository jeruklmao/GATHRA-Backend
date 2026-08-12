# GATHRA Backend agent guide

Read [README.md](README.md) and [docs/architecture.md](docs/architecture.md)
before changing code, provider configuration, or provider data. The Android
client lives in the independent
[GATHRA-Android repository](https://github.com/JerukLMAO/GATHRA-Android).

## Purpose and verified baseline

GATHRA is a native Indonesian Android route-preview and foreground-navigation
pilot. Its stable boundary is:

```text
Android -> NestJS -> GraphHopper
                 -> Photon
                 -> in-memory simulated flood provider
```

- The live NestJS API base URL is `https://api.gathra.my.id/`.
- Health, route preview, autocomplete, reverse geocoding, and the read-only
  flood endpoint have been verified through public HTTPS.
- The public development flood endpoint returns HTTP 404.
- GraphHopper and Photon have no public provider port.
- Swagger is currently public at `https://api.gathra.my.id/api/docs` because
  the backend enables it unconditionally.
- Repository changes are not automatically deployed. Server update, rollback,
  credentials, and Cloudflare configuration are separate operational work.

The geocoding pilot covers Jakarta Pusat, Jakarta Selatan, Kota Tangerang, Kota
Tangerang Selatan, and the versioned buffered envelope in
`geocoding/region/region-config.json`. Do not spell Tangerang as “Tanggerang”
except in explicit typo-quality fixtures.

## Backend and provider rules

- Keep normalized API DTOs independent of GraphHopper and Photon response
  types.
- GeoJSON positions are `[longitude, latitude]`; the Android client constructs
  `GeoPoint` as latitude, then longitude.
- GraphHopper signs are normalized into GATHRA manoeuvre enums.
- Keep provider services private on Compose networks. Only NestJS port 3000
  may be published for local development.
- Photon is the normal geocoder. `GEOCODING_PROVIDER=fake` is allowed only for
  deterministic backend development and tests.
- Preserve the client contract that outside-coverage suggestions may be shown
  but cannot be selected.
- Do not download, rebuild, replace, or delete Photon indexes implicitly.
  Candidate volumes, checksums, quality checks, and rollback must be explicit.
- Do not delete GraphHopper caches without first resolving the exact data and
  named volume being replaced.
- Never commit API keys, tokens, `.env`, signing material, generated graphs,
  Photon indexes, PBF files, address-like logs, or deployment artifacts.

## Flood-safety invariants

- Flood hazards are simulated, in-memory, per-process, and not a public-safety
  data source.
- Development mutation endpoints are unauthenticated and disabled by default.
  Enable them only for an isolated local test stack.
- A route intersecting a `BLOCKED` polygon cannot be selectable or
  recommended. Blocked-only provider results return `NO_ROUTE_DUE_TO_FLOOD`.
- `UNKNOWN` and `NOT_EVALUATED` are never represented as LOW.
- A route-risk snapshot must match the visible hazard snapshot. Mismatch
  triggers guarded recalculation; stale guidance must not imply current safety.
- Preserve generation and target-snapshot checks in preview and navigation so
  late responses cannot replace newer guidance.
- Do not describe missing, stale, or simulated flood data as evidence that a
  route is safe.
- Do not change flood-risk multipliers, evaluation, ranking, or snapshot
  behavior as part of unrelated work.

## High-risk files

- `src/routes/graphhopper.client.ts`: provider validation and step
  geometry intervals.
- `src/routes/routes.service.ts`: flood-aware route filtering/ranking.
- `src/geocoding/`: opaque tokens, private-query handling, regional
  policy, cache, and provider normalization.
- `src/flood/`: simulated snapshot semantics and default-closed tools.
- `compose.yaml` and `geocoding/scripts/`: private networking,
  persistent provider data, and index management.

## Verification

```bash
npm ci
npm run build
npm run test:unit
npm run test:integration
npm audit --omit=dev
```

Run focused tests first, then the full relevant matrix. Never run a full Photon
import merely to validate source changes.

## Current limitations and narrow priorities

- Flood snapshots have no PostgreSQL/PostGIS persistence, multi-instance
  consistency, MQTT/sensor ingestion, or real-time push.
- GraphHopper motorcycle costing is not calibrated against Indonesian access
  rules or field observations.
- The geocoding corpus is source-derived smoke data, not an independently
  verified address register. Promote independently reviewed cases before using
  it as an acceptance gate.
- Exercise Photon candidate-volume backup, restore, and rollback on disposable
  data before relying on the procedure operationally.
- A future flood-storage milestone should preserve `FloodHazardProvider` while
  adding transactional immutable PostgreSQL/PostGIS snapshots; keep sensor
  ingestion out of that storage milestone.

## Onboarding checklist

1. Run `git status --short --branch`, inspect the current diff, and identify the
   actual default branch before editing.
2. Read the two retained documentation files relevant to the change.
3. Confirm the selected provider mode and whether checked-in defaults or an
   explicit local override should be used.
4. Inspect source, tests, workflows, and provider configuration rather than
   trusting historical PR text or generated reports.
5. Preserve coordinate authority, provider privacy, foreground-only location,
   and flood-safety invariants.
6. Before changing provider data, verify source, checksum, compatibility,
   resource needs, region version, rollback volume, and free space.
7. Run focused checks, then the full relevant verification matrix, and report
   only results actually observed.
