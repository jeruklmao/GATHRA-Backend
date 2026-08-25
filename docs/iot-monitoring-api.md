# Future `/node` frontend monitoring API

This is the read contract for a future page at `https://gathra.my.id/node`.
The page itself is deliberately not implemented here. Monitoring endpoints are
public and read-only and never require or reveal the Gateway ingestion token.
The Backend's read-only CORS allowlist defaults to `https://gathra.my.id` and
can be replaced with a comma-separated `IOT_MONITOR_ALLOWED_ORIGINS` value for
local frontend development. Entries must be exact HTTP(S) origins without
paths, credentials, queries, fragments, or wildcards.

All history uses `serverReceivedAt` as its trusted timeline. Gateway UTC is
also returned when it was trusted at capture. No `ONLINE` boolean is invented;
clients receive `lastSeenAt` and can define a reviewed freshness policy later.
For Protocol 2 rows, the retained response field `bootSessionId` contains the
Node persistentSessionId. The legacy name is preserved to avoid a monitoring
API/database rewrite; it no longer implies a session created at every boot.

## List Nodes

```http
GET /api/v1/iot/nodes?limit=200
```

Nodes are ordered by `lastSeenAt` descending. `limit` defaults to 200 and is
bounded by `IOT_MONITOR_MAX_LIMIT` (hard configuration maximum 1000).

```json
[
  {
    "nodeId": "GTH-AABBCCDDEEFF",
    "firstSeenAt": "2026-08-18T05:00:01.000Z",
    "lastSeenAt": "2026-08-18T05:10:01.000Z",
    "lastGateway": {
      "gatewayId": "GTH-GW-112233445566",
      "hardwareMac": "11:22:33:44:55:66"
    },
    "latestTelemetry": {
      "id": 12345,
      "nodeId": "GTH-AABBCCDDEEFF",
      "bootSessionId": 100,
      "sequence": 42,
      "measurement": {
        "medianEchoUs": 4321,
        "rawDistanceMm": 742,
        "acceptedDistanceMm": 1498,
        "madMm": 3,
        "temperatureC": 29.41,
        "humidityPercent": 82.13,
        "batteryMv": 4012,
        "validSamples": 7,
        "totalSamples": 7,
        "filterState": {
          "code": 4,
          "name": "TRANSIENT_REJECTED"
        },
        "qualityFlags": 7,
        "healthFlags": 128
      },
      "reception": {
        "gatewayId": "GTH-GW-112233445566",
        "hardwareMac": "11:22:33:44:55:66",
        "gatewayBootSessionId": 1234567890,
        "gatewayReceivedAt": "2026-08-18T05:10:00.123Z",
        "gatewayTimeTrusted": true,
        "gatewayUptimeMs": 123456,
        "serverReceivedAt": "2026-08-18T05:10:01.000Z",
        "rssiDbm": -91.5,
        "snrDb": 8.25,
        "frequencyErrorHz": -731,
        "packetLength": 56
      }
    }
  }
]
```

Unavailable raw/accepted distance, temperature, or humidity is JSON `null`,
never a protocol sentinel.

## Node detail/latest

```http
GET /api/v1/iot/nodes/GTH-AABBCCDDEEFF
```

The response is one object with the same Node metadata and `latestTelemetry`
shape shown above. Unknown valid Node IDs return 404.

## Bounded history

```http
GET /api/v1/iot/nodes/GTH-AABBCCDDEEFF/telemetry?limit=200
GET /api/v1/iot/nodes/GTH-AABBCCDDEEFF/telemetry?limit=200&beforeId=12345
GET /api/v1/iot/nodes/GTH-AABBCCDDEEFF/telemetry?from=2026-08-17T00:00:00Z&to=2026-08-18T00:00:00Z
```

`from` and `to` are inclusive ISO-8601 bounds on `serverReceivedAt`; `from`
must not exceed `to`. `beforeId` requests older rows for stable newest-first
pagination. Responses are:

```json
{
  "nodeId": "GTH-AABBCCDDEEFF",
  "items": [
    {
      "id": 12345,
      "nodeId": "GTH-AABBCCDDEEFF",
      "bootSessionId": 100,
      "sequence": 42,
      "measurement": {
        "medianEchoUs": 4321,
        "rawDistanceMm": 742,
        "acceptedDistanceMm": 1498,
        "madMm": 3,
        "temperatureC": 29.41,
        "humidityPercent": 82.13,
        "batteryMv": 4012,
        "validSamples": 7,
        "totalSamples": 7,
        "filterState": {
          "code": 4,
          "name": "TRANSIENT_REJECTED"
        },
        "qualityFlags": 7,
        "healthFlags": 128
      },
      "reception": {
        "gatewayId": "GTH-GW-112233445566",
        "hardwareMac": "11:22:33:44:55:66",
        "gatewayBootSessionId": 1234567890,
        "gatewayReceivedAt": "2026-08-18T05:10:00.123Z",
        "gatewayTimeTrusted": true,
        "gatewayUptimeMs": 123456,
        "serverReceivedAt": "2026-08-18T05:10:01.000Z",
        "rssiDbm": -91.5,
        "snrDb": 8.25,
        "frequencyErrorHz": -731,
        "packetLength": 56
      }
    }
  ],
  "nextBeforeId": 12146
}
```

`nextBeforeId` is non-null when a full page was returned. Pass it unchanged on
the next request. The endpoint never returns the entire database in one call.

For packet diagnostics only:

```http
GET /api/v1/iot/nodes/GTH-AABBCCDDEEFF/telemetry?limit=1&includeRaw=true
```

adds `rawPayloadBase64`. Omit it for charts.

## Chart mapping

Use the following fields without redesigning ingestion/storage:

| Chart/indicator | Field |
| --- | --- |
| raw vs accepted distance | `measurement.rawDistanceMm`, `measurement.acceptedDistanceMm` |
| temperature | `measurement.temperatureC` |
| humidity | `measurement.humidityPercent` |
| battery | `measurement.batteryMv` |
| radio quality | `reception.rssiDbm`, `reception.snrDb` |
| filter state bands/labels | `measurement.filterState.code/name` |
| trusted x-axis | `reception.serverReceivedAt` |
| Gateway capture comparison | `reception.gatewayReceivedAt` plus `gatewayTimeTrusted` |

Keep gaps as `null`; do not coerce unavailable measurements to zero. Quality
and health flags are integers so a future UI can decode the exact Node bitfield
without losing unknown future bits.

This API contains raw observations, not flood risk. Do not label `LOW`,
`MEDIUM`, `HIGH`, `BLOCKED`, infer water height, or modify routing until real
installation coordinates, datum, road geometry, coverage, and thresholds are
available and reviewed.
