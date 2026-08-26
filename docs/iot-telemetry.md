# IoT raw telemetry persistence

This module accepts exact GATHRA Node Protocol 3 TELEMETRY packets and provides
read-only raw monitoring. It does not implement Gateway/Node command queues,
command APIs, or remote scheduling. After raw persistence commits, the separate
sensor-flood module may derive water height and current hazard state for a
configured deployment; see
[sensor-flood-hazards.md](sensor-flood-hazards.md). Protocol 1 and 2 packets are
rejected; there is no compatibility decoder.

## Ingestion boundary

POST /api/v1/iot/telemetry/batch accepts 1–50 readings with Gateway Bearer authentication. Each reading carries canonical Base64 raw RF bytes, declared length, reception time/trust, uptime, Gateway boot ID, RSSI, SNR, and frequency error.

The Backend independently checks:

- decoded packet is at most 96 bytes;
- magic GT, protocolVersion=3, messageType=TELEMETRY;
- 1–24 character Node ID and allowed ASCII alphabet;
- exact 62+nodeIdLength framing with no trailing bytes;
- big-endian sensor and persistent identity fields;
- filter, boot, RTC, schedule, command and result enum ranges;
- RTC/schedule/last-command validity relationships;
- canonical unavailable sentinels and declared packet length.

ACK_COMMAND and COMMAND_RESULT are rejected because Backend persistence accepts telemetry only. Invalid records receive REJECTED_INVALID without preventing valid records in the same batch. Database errors fail the request so the Gateway retains its queued records.

GET /api/v1/iot/gateway/ping reports nodeProtocolVersion=3, API/max-batch compatibility, authentication, and a live database query without mutating telemetry.

## Protocol 3 data

The decoder stores the exact packet as BYTEA and persists existing sensor columns: median echo, raw and accepted distance, MAD, temperature, humidity, battery, sample counts, filter state, quality flags, and health flags. Protocol 3 appends big-endian uint32 `referenceDistanceMm` at telemetry-payload offset 53 (absolute packet offset `58+nodeIdLength`). The v3 telemetry payload is 57 bytes and the total packet is `62+nodeIdLength` bytes. Diagnostics remain recoverable from BYTEA; this migration does not add a Backend command model.

Protocol 3 persistentSessionId is stored in the existing node_boot_session_id column. That legacy name is intentionally retained to preserve historical rows, indexes, uniqueness, monitoring DTOs, and production deployment shape. The unique key remains:

~~~sql
UNIQUE (node_id, node_boot_session_id, node_sequence)
~~~

Migration 003 adds nullable BIGINT `reference_distance_mm` with a checked 1–4294967295 domain and expands the historical database version constraint to `IN (1,2,3)`. The production application decoder itself is Protocol 3-only. No table or historical migration is rewritten or dropped.

INSERT ... ON CONFLICT DO NOTHING RETURNING id makes retries idempotent. A committed retry returns DUPLICATE.

Raw ingestion remains the primary durability boundary. Derived flood-state
recomputation runs only after the raw batch transaction commits. Missing
deployment or a classifier failure cannot reject or roll back valid telemetry;
failures are logged and can be recovered by a later packet or deployment PUT.

## Sentinels and numeric storage

Unsigned 32-bit Node/Gateway values use checked BIGINT. Distance FFFFFFFF, temperature 8000, and humidity FFFF become SQL NULL. Wire `referenceDistanceMm=0` also becomes SQL NULL, while 1–UINT32_MAX is stored exactly; the original zero remains present in `raw_payload`. Flags and exact bytes remain intact. A non-VALID RTC state is never exposed as trusted UTC.

## Gateway credential

The raw Gateway token is never stored. Generate a token/digest pair with:

~~~bash
npm run iot:token
~~~

Provision the raw token to Gateway NVS and configure only its SHA-256 digest in Backend. The guard uses constant-time digest comparison; missing configuration fails closed.

## Migrations and tests

Migrations execute transactionally under a PostgreSQL advisory lock and are recorded in schema_migrations. The existing PostgreSQL volume and telemetry rows are preserved.

~~~bash
npm test -- --runInBand
npm run build
npm run test:integration
~~~

Integration tests start the isolated PostgreSQL service from compose.test.yaml, exercise real migrations and ingestion/monitoring routes, and remove the disposable service afterward.

Monitoring remains read-only and preserves the public bootSessionId field name even though its Node-side value is now persistentSessionId. See docs/iot-monitoring-api.md for that response envelope.
