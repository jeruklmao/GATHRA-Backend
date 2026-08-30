# Public IoT monitoring API

These endpoints are public, read-only, non-cacheable, and never require or
reveal the Gateway ingestion credential. Their CORS allowlist is configured by
exact origin through `IOT_MONITOR_ALLOWED_ORIGINS`.

All history ordering and date filtering use trusted `serverReceivedAt`.
`gatewayReceivedAt` is also returned when the Gateway trusted its clock.
`bootSessionId` is the public field containing the Node persistent session.

## List Nodes

```http
GET /api/v1/iot/nodes?limit=200
```

Nodes are ordered by `lastSeenAt` descending. `limit` defaults to 200 and is
bounded by `IOT_MONITOR_MAX_LIMIT`, whose hard maximum is 1000.

Each item contains `nodeId`, `firstSeenAt`, `lastSeenAt`, `lastGateway`, and
`latestTelemetry`. Telemetry includes normalized measurement and reception
objects. Unavailable sensor values are JSON `null`, never protocol sentinels.

## Current Node detail

```http
GET /api/v1/iot/nodes/GTH-AABBCCDDEEFF
```

The response uses the same Node summary and telemetry shape. A valid unknown
Node ID returns 404.

## Bounded telemetry history

```http
GET /api/v1/iot/nodes/GTH-AABBCCDDEEFF/telemetry?limit=200
GET /api/v1/iot/nodes/GTH-AABBCCDDEEFF/telemetry?limit=200&beforeId=12345
GET /api/v1/iot/nodes/GTH-AABBCCDDEEFF/telemetry?from=2026-08-29T00:00:00Z&to=2026-08-30T00:00:00Z
```

`from` and `to` are inclusive ISO-8601 bounds and `from` must not exceed `to`.
`beforeId` is the newest-first pagination cursor. The response is:

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
        "acceptedDistanceMm": 739,
        "referenceDistanceMm": 1500,
        "madMm": 3,
        "temperatureC": 29.41,
        "humidityPercent": 82.13,
        "batteryMv": 4012,
        "validSamples": 7,
        "totalSamples": 7,
        "filterState": { "code": 0, "name": "STABLE" },
        "qualityFlags": 7,
        "healthFlags": 0
      },
      "reception": {
        "gatewayId": "GTH-GW-112233445566",
        "hardwareMac": "11:22:33:44:55:66",
        "gatewayBootSessionId": 1234567890,
        "gatewayReceivedAt": "2026-08-30T05:10:00.123Z",
        "gatewayTimeTrusted": true,
        "gatewayUptimeMs": 123456,
        "serverReceivedAt": "2026-08-30T05:10:01.000Z",
        "rssiDbm": -91.5,
        "snrDb": 8.25,
        "frequencyErrorHz": -731,
        "packetLength": 78
      }
    }
  ],
  "nextBeforeId": 12146
}
```

`nextBeforeId` is non-null when a full page is returned. Pass it unchanged to
request the next page. `includeRaw=true` adds `rawPayloadBase64` for packet
diagnostics; omit it for ordinary monitoring and charts.

This API contains raw observations, not classified flood state. Android uses
`GET /api/v1/sensors/:nodeId` for sanitized current flood/sensor/Gateway detail
and does not use the raw history contract.
