# GATHRA routing backend

This service owns GATHRA's route-preview contract and keeps GraphHopper private.
It deliberately contains no authentication, database, geocoding, traffic,
telemetry, flood logic, or turn-by-turn navigation.

## Runtime architecture

```text
Android -> NestJS :3000 -> GraphHopper :8989 (Compose network only)
```

Only the NestJS port is published by `compose.yaml`. GraphHopper uses its own
Docker image, a pinned GraphHopper 11.0 web-service JAR whose Maven checksum is
verified during the build, and explicit `car` and `motorcycle` profiles.

The motorcycle profile uses GraphHopper's built-in `motorcycle.json` costing.
GraphHopper itself describes this model as requiring adaptation and testing
before production use. Treat it as experimental for this milestone: it has not
been calibrated against Indonesian regulations, local access rules, or expected
motorcycle travel times.

## Prerequisites

- Docker Engine with the Docker Compose v2 plugin
- `curl` and `jq` for the smoke script
- Node.js 24 LTS and npm for host-side tests

Copy `.env.example` to `.env` only when overriding defaults. The checked-in OSM
XML file is a tiny synthetic Jakarta-area road graph intended for deterministic
development and health checks. It is not a city map.

Start the stack:

```bash
docker compose --project-directory backend -f backend/compose.yaml up \
  --build --wait
```

Run the complete Compose smoke check (it tears down containers but preserves
the graph-cache volume):

```bash
backend/scripts/compose-health-check.sh
```

For useful Jakarta–Tangerang coverage, prepare a current OpenStreetMap extract
for the buffered bounding box below (longitude/latitude order):

```bash
106.52,-6.40,106.90,-6.06
```

This box fully contains Jakarta Barat, Jakarta Selatan, Kota Tangerang, and
Tangerang Selatan, with a buffer for roads crossing municipal boundaries. One
reproducible Fedora workflow is:

```bash
sudo dnf install osmium-tool
mkdir -p backend/routing-data
curl --fail --location --retry 3 \
  --output backend/routing-data/java-latest.osm.pbf \
  https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf
osmium extract \
  --bbox=106.52,-6.40,106.90,-6.06 \
  --strategy=complete_ways \
  --set-bounds \
  backend/routing-data/java-latest.osm.pbf \
  --output backend/routing-data/gathra-jakarta-tangerang.osm.pbf
osmium tags-filter \
  backend/routing-data/gathra-jakarta-tangerang.osm.pbf \
  nw/highway r/type=restriction \
  --output backend/routing-data/gathra-jakarta-tangerang-routing.osm.pbf
osmium check-refs \
  backend/routing-data/gathra-jakarta-tangerang-routing.osm.pbf
```

Point `GATHRA_OSM_FILE` in `backend/.env` at the routing-only PBF, allocate a
heap appropriate to the extract, and set `GRAPH_HOPPER_MIN_NETWORK_SIZE=200`.
The default remains `0` because the checked-in deterministic fixture is smaller
than GraphHopper's regional subnetwork threshold.

Changing the OSM input, routing profile, or subnetwork threshold requires
rebuilding the generated graph. Remove only the named `graphhopper-cache`
volume deliberately when switching data; the smoke script does not delete it.
The source PBF and generated graph data are ignored by Git. Retain the required
OpenStreetMap attribution and comply with the ODbL when distributing derived
data.

## API

Interactive OpenAPI documentation is served at:

- `http://localhost:3000/api/docs`
- `http://localhost:3000/api/docs-json`

### `POST /api/v1/routes/preview`

`alternatives` is the number of extra routes beyond the recommended route and
must be `0` or `1`. JSON numeric strings, unknown properties, identical points,
unsupported travel modes, and out-of-range coordinates are rejected.

```json
{
  "origin": {
    "latitude": -6.2,
    "longitude": 106.8167
  },
  "destination": {
    "latitude": -6.19,
    "longitude": 106.8272
  },
  "travelMode": "CAR",
  "alternatives": 1
}
```

A successful response has one route, or two when GraphHopper finds a distinct
alternative. GeoJSON uses the standard `[longitude, latitude]` position order:

```json
{
  "requestId": "4a0ee423-066e-4db7-919a-f3d1f36db680",
  "routes": [
    {
      "id": "route_1b8b94a5f32e8c7d",
      "isRecommended": true,
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [106.8167, -6.2],
          [106.8272, -6.19]
        ]
      },
      "summary": {
        "distanceMeters": 1642,
        "durationSeconds": 173
      }
    }
  ],
  "metadata": {
    "travelMode": "CAR",
    "requestedAlternatives": 1,
    "returnedAlternatives": 0
  }
}
```

The route ID is an opaque stable fingerprint of API version, travel mode, and
canonical geometry. Clients must not infer provider details from it.
The provider adapter rejects a result when its street-snapped start or end is
more than 500 metres from the requested coordinate, returning `NO_ROUTE`
instead of presenting an out-of-coverage route.

### `GET /api/v1/health`

This is a readiness endpoint, not merely a process liveness endpoint. It returns
HTTP 200 only after the private routing engine responds:

```json
{
  "status": "ok",
  "service": "gathra-routing-api",
  "checks": {
    "routing": "up"
  }
}
```

It returns HTTP 503 with `status: "unavailable"` and `routing: "down"` when
GraphHopper is unavailable.

## Errors

API errors never include stack traces or GraphHopper response bodies:

```json
{
  "requestId": "4a0ee423-066e-4db7-919a-f3d1f36db680",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The route preview request is invalid.",
    "retryable": false,
    "details": [
      {
        "field": "origin.latitude",
        "reason": "latitude must not be less than -90"
      }
    ]
  }
}
```

| HTTP | Code | Retryable |
| ---: | --- | :---: |
| 400 | `VALIDATION_ERROR` | no |
| 404 | `NOT_FOUND` | no |
| 422 | `NO_ROUTE` | no |
| 502 | `ROUTING_RESPONSE_INVALID` | yes |
| 503 | `ROUTING_UNAVAILABLE` | yes |
| 504 | `ROUTING_TIMEOUT` | yes |
| 500 | `INTERNAL_ERROR` | yes |

The service accepts a safe `X-Request-Id` value and otherwise generates one.
The same value is returned in the response header and body.

## Host-side development and tests

```bash
cd backend
npm ci
npm run build
npm run test:unit
npm run test:integration
```

Unit tests cover GraphHopper request/response translation, strict upstream
geometry checks, timeouts, stable route IDs, and provider-error mapping.
Integration tests start a real Nest application with a provider stub, exercising
versioning, validation, error envelopes, health, and OpenAPI without network
access.

## Android host reachability

- Android Emulator: use `http://10.0.2.2:3000/`.
- USB-connected physical device: run
  `adb reverse tcp:3000 tcp:3000` and use `http://127.0.0.1:3000/`.
- Same-LAN physical device: use the Fedora host's LAN address, bind the backend
  to `0.0.0.0` (already configured), and explicitly allow TCP port 3000 in the
  Fedora firewall for the trusted network.

Never point Android at port 8989. That endpoint is an implementation detail and
is intentionally not published.
