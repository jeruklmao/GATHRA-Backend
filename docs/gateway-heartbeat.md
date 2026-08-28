# Gateway Firmware 2.2 heartbeat

Firmware 2.2 sends its schema-version-1 operational heartbeat to
`POST /api/v1/iot/gateway/heartbeat` using the existing Gateway Bearer
credential. This is additive to LoRa Protocol 3 telemetry ingestion. Backend
strictly validates the documented firmware JSON, caps the normalized payload at
16 KiB, checks cross-field consistency, and binds `gatewayId` to the stable MAC
identity in `iot_gateways`.

`iot_gateway_status` stores one latest snapshot per Gateway.
`iot_gateway_metrics` stores one compact sample per accepted heartbeat. Backend
receipt time is authoritative for freshness and chart time; Gateway UTC remains
diagnostic and is ignored when `timeValid` is false. Metrics older than 30 days
are removed by a six-hour best-effort cleanup. Cleanup failure never interrupts
heartbeat or Protocol 3 ingestion.

Status is derived at read time from the reported, locally configured heartbeat
interval: age at or below two intervals is `ONLINE`, above two through five is
`STALE`, and above five is `OFFLINE`. A registered pre-2.2 Gateway with no
heartbeat is `HEARTBEAT_UNAVAILABLE`, not falsely offline. The interval is
read-only in Backend and remains configurable only on the Gateway local
dashboard.

Authenticated dashboard APIs expose Gateway list, detail, and bounded chart
history under `/api/v1/admin/dashboard/gateways`. Supported chart ranges are 1h,
24h, 7d, and 30d with server-side bucketing to at most roughly 1,000 samples.
Accepted heartbeats emit an authenticated SSE event on the existing dashboard
event stream.

The dashboard shows identity, runtime/heap, network, NTP, LoRa, ACK, durable
queue, and command observations. ACK values mean RX-to-ACK start, RX-to-ACK
complete, and ACK transmit duration as observed by the Gateway; they are not
end-to-end Node acknowledgment round-trip times. Counters and uptime may reset
after a reboot and are labeled as since-boot values where applicable.

At a 60-second interval, one Gateway produces 43,200 rows in 30 days. With the
compact row and two useful indexes, operational planning should allow roughly
15–25 MiB per Gateway per 30 days (about 150–250 MiB for ten Gateways; actual
PostgreSQL size varies with tuple and index overhead).

No Gateway reboot, OTA, Wi-Fi configuration, heartbeat interval control, remote
shell, or command control is exposed by Backend or the Admin Dashboard.
