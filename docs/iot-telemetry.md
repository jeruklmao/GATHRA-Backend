# IoT raw telemetry persistence

This module accepts exact GATHRA Node Protocol 2 TELEMETRY packets and provides read-only monitoring. It does not implement Gateway/Node command queues, command APIs, remote scheduling, flood classification, sensor placement, or route geometry.

## Ingestion boundary

POST /api/v1/iot/telemetry/batch accepts 1–50 readings with Gateway Bearer authentication. Each reading carries canonical Base64 raw RF bytes, declared length, reception time/trust, uptime, Gateway boot ID, RSSI, SNR, and frequency error.

The Backend independently checks:

- decoded packet is at most 96 bytes;
- magic GT, protocolVersion=2, messageType=TELEMETRY;
- 1–24 character Node ID and allowed ASCII alphabet;
- exact 58+nodeIdLength framing with no trailing bytes;
- big-endian sensor and persistent identity fields;
- filter, boot, RTC, schedule, command and result enum ranges;
- RTC/schedule/last-command validity relationships;
- canonical unavailable sentinels and declared packet length.

ACK_COMMAND and COMMAND_RESULT are rejected because Backend persistence accepts telemetry only. Invalid records receive REJECTED_INVALID without preventing valid records in the same batch. Database errors fail the request so the Gateway retains its queued records.

GET /api/v1/iot/gateway/ping reports nodeProtocolVersion=2, API/max-batch compatibility, authentication, and a live database query without mutating telemetry.

## Protocol 2 data

The decoder stores the exact packet as BYTEA and persists existing sensor columns: median echo, raw and accepted distance, MAD, temperature, humidity, battery, sample counts, filter state, quality flags, and health flags. Protocol 2 diagnostics are validated from the raw packet and remain recoverable from BYTEA; this compatibility migration does not add a Backend command model.

Protocol 2 persistentSessionId is stored in the existing node_boot_session_id column. That legacy name is intentionally retained to preserve historical Protocol 1 rows, indexes, uniqueness, monitoring DTOs, and production deployment shape. The unique key remains:

~~~sql
UNIQUE (node_id, node_boot_session_id, node_sequence)
~~~

Migration 002 keeps historical protocol_version=1 rows and expands the check to IN (1,2). The application decoder itself is v2-only. No tables are dropped.

INSERT ... ON CONFLICT DO NOTHING RETURNING id makes retries idempotent. A committed retry returns DUPLICATE.

## Sentinels and numeric storage

Unsigned 32-bit Node/Gateway values use checked BIGINT. Distance FFFFFFFF, temperature 8000, and humidity FFFF become SQL NULL. Flags and exact bytes remain intact. A non-VALID RTC state is never exposed as trusted UTC.

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
