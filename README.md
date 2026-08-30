# GATHRA Backend

GATHRA Backend is the NestJS service that joins GATHRA routing, geocoding,
Protocol 3 telemetry, sensor flood classification, Gateway monitoring, and
public Android contracts. PostgreSQL stores telemetry, sensor deployment policy,
derived state, Gateway heartbeats, and admin metrics. GraphHopper and Photon are
private provider services behind the Backend.

The public API base URL is <https://api.gathra.my.id/>.

```text
GATHRA Node --LoRa Protocol 3--> GATHRA Gateway
                                      |
                                      | authenticated HTTPS
                                      v
Android/public clients ----------> NestJS
                                    |-- PostgreSQL 17
                                    |-- GraphHopper 11
                                    `-- Photon 0.5.0
```

Production flood hazards are sensor-backed modeled observations. They do not
guarantee that an area or route is safe.

## Local development

Requirements:

- Docker Engine with Docker Compose v2
- Node.js `>=20.11 <25` and npm
- `curl` for health checks
- a prepared Photon data volume for Photon-backed geocoding

Install dependencies and run the quality gates:

```bash
npm ci
npm run build
npm run test:unit
npm run test:integration
npm audit --omit=dev
```

Start the Compose stack after preparing the Photon data volume:

```bash
geocoding/scripts/download-photon-data.sh
docker compose up --build --wait
geocoding/scripts/health-check.sh
```

The checked-in Compose configuration uses the in-memory flood provider unless
`FLOOD_PROVIDER=sensor` is set. Use the sensor provider when testing the current
Node-to-Android production path:

```bash
FLOOD_PROVIDER=sensor docker compose up --build --wait
```

The application-level production default is also `sensor` when `NODE_ENV` is
`production` and `FLOOD_PROVIDER` is unset. The in-memory provider and its
mutation routes are isolated development tools; Android builds always use the
remote Backend contract.

Stop the stack without deleting named provider data:

```bash
docker compose down
```

## Current API surfaces

URI versioning creates `/api/v1`.

Public, read-only or user-facing routes:

- `POST /api/v1/routes/preview`
- `GET /api/v1/geocoding/autocomplete`
- `GET /api/v1/geocoding/search`
- `GET /api/v1/geocoding/places/:id`
- `GET /api/v1/geocoding/reverse`
- `GET /api/v1/flood-hazards`
- `GET /api/v1/sensors/:nodeId`
- `GET /api/v1/iot/nodes`
- `GET /api/v1/iot/nodes/:nodeId`
- `GET /api/v1/iot/nodes/:nodeId/telemetry`
- `GET /api/v1/health`

Gateway-authenticated routes:

- `POST /api/v1/iot/telemetry/batch`
- `POST /api/v1/iot/gateway/heartbeat`
- `GET /api/v1/iot/gateway/ping`

Flood-administrator routes are registered only when
`ENABLE_FLOOD_ADMIN_ENDPOINTS=true` and a valid digest is configured:

- `GET /api/v1/admin/iot/sensor-deployments`
- `GET /api/v1/admin/iot/sensor-deployments/:nodeId`
- `PUT /api/v1/admin/iot/sensor-deployments/:nodeId`

The browser admin dashboard is served at `/admin` when
`ADMIN_DASHBOARD_ENABLED=true`. Its session and dashboard APIs are separate from
the public and flood-administrator contracts.

OpenAPI is available at `/api/docs` and `/api/docs-json`.

## Routing and geocoding

Route preview accepts `CAR` or `MOTORCYCLE` and zero or one extra alternative:

```bash
curl --fail --request POST \
  --header 'Content-Type: application/json' \
  --data '{
    "origin":{"latitude":-6.1939,"longitude":106.8250},
    "destination":{"latitude":-6.2124,"longitude":106.8094},
    "travelMode":"CAR",
    "alternatives":1
  }' \
  http://127.0.0.1:3000/api/v1/routes/preview
```

GraphHopper receives request-scoped polygons and runtime routing multipliers.
NestJS independently checks returned geometry. A multiplier of 1 has no flood
penalty, a value between 0 and 1 penalizes the route, and 0 is a hard exclusion
regardless of the level name. Usable routes are ranked by modeled flood impact,
then normal route cost.

Geocoding returns normalized suggestions and Backend-issued opaque place tokens.
Clients do not call Photon or construct provider identifiers. GeoJSON positions
are `[longitude, latitude]`.

## Protocol 3 telemetry

The Gateway submits 1–50 exact Base64 TELEMETRY packets plus capture metadata.
The Backend independently validates and decodes Protocol 3, stores the raw bytes
and normalized measurements, and enforces uniqueness on Node ID, persistent
session, and sequence. A committed retry returns `DUPLICATE`.

Unavailable wire values become SQL/JSON `NULL`; exact raw bytes remain stored.
The Node reference distance is stored as `NULL` when the wire value is zero.
Derived sensor-state recomputation occurs after raw persistence and cannot
reject a valid committed telemetry row.

Generate a Gateway token and digest for local provisioning with:

```bash
npm run iot:token
```

Provision the raw token only to the Gateway and configure only its SHA-256
digest in `IOT_GATEWAY_TOKEN_SHA256`. Never commit raw credentials or `.env`.
See [IoT telemetry](docs/iot-telemetry.md) and
[monitoring API](docs/iot-monitoring-api.md).

## Sensor classification

Each enabled sensor deployment stores position, coverage polygon, freshness
policy, thresholds, hysteresis, level multipliers, and an optional reference
distance override. The effective reference is:

```text
referenceDistanceOverrideMm when non-null
Node referenceDistanceMm otherwise
```

Saving or clearing the override recomputes authoritative state immediately from
the latest applicable telemetry. With usable accepted distance and reference:

```text
waterHeightMm = max(0, effectiveReferenceDistanceMm - acceptedDistanceMm)
```

Thresholds and routing multipliers are runtime deployment configuration, not
Protocol constants. Classification is LOW below the medium threshold, MEDIUM
at or above medium, HIGH at or above high, and BLOCKED at or above blocked.
Hysteresis applies only from a fresh valid state using the same configuration
version.

`FRESH`, `STALE`, and `NO_TELEMETRY` are distinct. Stale or absent telemetry
produces effective `UNKNOWN` and the configured UNKNOWN multiplier. `UNKNOWN`
does not mean LOW or safe. See
[sensor flood hazards](docs/sensor-flood-hazards.md).

## Public sensor contract

`GET /api/v1/sensors/:nodeId` is unauthenticated, read-only, and non-cacheable.
For an enabled deployment it returns:

```json
{
  "nodeId": "GTH-10003BD4BCFC",
  "position": { "latitude": -6.2, "longitude": 106.8 },
  "flood": {
    "waterHeightMm": 120,
    "effectiveLevel": "MEDIUM",
    "freshness": "FRESH",
    "observedAt": "2026-08-30T01:02:03.000Z"
  },
  "measurement": {
    "acceptedDistanceMm": 1380,
    "temperatureC": 29.4,
    "humidityPercent": 82.1
  },
  "gateway": {
    "status": "ONLINE",
    "lastHeartbeatAt": "2026-08-30T01:02:30.000Z",
    "radioReceptionStatus": "RECENT",
    "latestRssiDbm": -91.5,
    "latestSnrDb": 8.25,
    "backendDeliveryStatus": "NORMAL"
  }
}
```

Measurement, flood, timestamp, and Gateway fields are nullable as defined in
source. The contract excludes raw distance, battery, payload/session data,
diagnostic flags, reference configuration, Gateway identity/network internals,
and sensor history.

## Gateway heartbeat and admin dashboard

Firmware 2.2.0 sends schema-1 operational heartbeats. The interval field is
optional at ingestion and defaults to 60 seconds; supplied values must be
15–3600 seconds. Backend freshness is `ONLINE` through two intervals, `STALE`
through five, and `OFFLINE` after five. No received heartbeat is reported as
unavailable, not offline. Compact heartbeat metrics are retained for 30 days;
raw telemetry has no automatic retention.

The self-contained admin dashboard provides Overview, Nodes, telemetry charts,
Gateways, sensor deployment configuration, server metrics, traffic, and
sanitized logs. State changes require a secure session and CSRF token. See
[Gateway heartbeat](docs/gateway-heartbeat.md) and
[admin dashboard](docs/admin-dashboard.md).

## Configuration

Supported variables are defined by `src/configuration.ts`, `.env.example`, and
`compose.yaml`. Major groups include:

- PostgreSQL: `DATABASE_URL` and Compose `POSTGRES_*`
- IoT: `IOT_GATEWAY_TOKEN_SHA256`, batch/monitor limits, CORS origins
- routing: GraphHopper URL, timeout, OSM file, heap, network threshold
- geocoding: provider/Photon URL, timeout, concurrency, rate, cache, region
- flood: provider, endpoint enable flags, admin token digest, geometry limits
- dashboard: enable flag, auth/observer mounts, session and metrics retention

Secret values, raw tokens, production database credentials, provider data,
routing graphs, deployment paths, and server access details must remain outside
Git.

## Safety

- `UNKNOWN` is not safe.
- `STALE` and `NO_TELEMETRY` are not LOW.
- An area outside configured coverage is not known flood-free.
- Route ranking and exclusion use modeled observations and cannot guarantee a
  safe journey.

---

Copyright © 2026 GATHRA Project. All rights reserved.

Source code and documentation in this repository are publicly viewable for inspection, academic review, and evaluation. No permission is granted to reproduce, redistribute, modify, commercialize, or create derivative works except where explicitly permitted by the repository's license or by written permission from the copyright holder.

If you use GATHRA in academic or research work, please provide appropriate attribution to the GATHRA Project and its associated publications.
