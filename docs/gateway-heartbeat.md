# Gateway operational heartbeat

GATHRA Gateway firmware **2.2.0** sends schema-1 heartbeats to:

```http
POST /api/v1/iot/gateway/heartbeat
Authorization: Bearer <gateway-token>
Content-Type: application/json
```

The endpoint uses the Gateway ingestion credential, accepts at most 16 KiB,
validates all fields and cross-field relationships, and returns HTTP 202 after
persistence.

`heartbeatIntervalSeconds` is optional for schema 1. An omitted value is 60;
an explicit value must be from 15 through 3600 seconds. The Backend treats the
field as a read-only report of Gateway-local configuration.

## Stored state and freshness

`iot_gateway_status` stores the latest accepted snapshot for each Gateway.
`iot_gateway_metrics` stores one compact sample per accepted heartbeat. Backend
receipt time is authoritative for freshness and chart time; Gateway UTC is
diagnostic.

Freshness is derived at read time:

```text
age <= 2 * interval -> ONLINE
age <= 5 * interval -> STALE
age >  5 * interval -> OFFLINE
no heartbeat        -> HEARTBEAT_UNAVAILABLE
```

The public sensor API maps `HEARTBEAT_UNAVAILABLE` to `UNAVAILABLE`. Missing
heartbeat support is not labeled offline.

Compact metric rows are retained for 30 days. Cleanup runs every six hours and
does not interrupt heartbeat or telemetry ingestion if it fails.

## Payload groups

The validated payload contains:

- schema and configured heartbeat interval;
- Gateway ID, stable MAC, firmware 2.2.0, Protocol 3, and build flavor;
- uptime, reset reason, persistent boot count, heap, image, and flash metrics;
- Wi-Fi connection diagnostics and telemetry-Backend connectivity state;
- trusted-time and NTP diagnostics;
- paired Node and latest LoRa reception/counters;
- Gateway-observed ACK counts, latency, and rolling statistics;
- durable queue depth/capacity/age and upload counters;
- pending and latest command summaries.

Credentials are not payload fields. Nullable timestamps use RFC 3339 UTC with
milliseconds. ACK latencies are measured by the Gateway from radio RX-done to
ACK start/completion; they are not Node round-trip measurements.

`backendConnectivityState` describes durable telemetry delivery only:
`UNKNOWN` before an operation, `HEALTHY` after success with no later failures,
`DEGRADED` after one or two consecutive failures, and `OFFLINE` after three.
Heartbeat outcomes do not feed that field.

## Admin visibility

The authenticated dashboard exposes Gateway list/detail and bounded metric
charts for 1h, 24h, 7d, and 30d ranges. Accepted heartbeats also emit a
session-authenticated dashboard SSE event. The Backend does not provide Gateway
reboot, OTA, Wi-Fi, heartbeat-interval, shell, or Node-command controls.
