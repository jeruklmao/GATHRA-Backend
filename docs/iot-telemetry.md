# Protocol 3 telemetry persistence

## Ingestion

`POST /api/v1/iot/telemetry/batch` accepts 1–50 readings with Gateway bearer
authentication. Each reading carries the exact canonical Base64 radio packet,
declared packet length, capture time and trust state, uptime, capture-time
Gateway boot identity, RSSI, SNR, and frequency error.

The Backend accepts Protocol 3 TELEMETRY only. It validates magic, version,
message type, Node ID, exact length, big-endian fields, enum and flag ranges,
sentinels, and cross-field relationships. Invalid records receive
`REJECTED_INVALID` without preventing valid records in the same batch. Database
failure fails the request so the Gateway retains its durable records.

`GET /api/v1/iot/gateway/ping` verifies authentication, Protocol/API
compatibility, maximum batch size, and PostgreSQL availability without writing
telemetry.

## Stored data

The Protocol 3 TELEMETRY payload is 57 bytes and total packet length is
`62 + nodeIdLength`. The Backend stores the exact packet as `BYTEA` plus:

- persistent session and sequence;
- median echo, raw distance, accepted distance, and MAD;
- temperature, humidity, battery, and sample counts;
- filter state, quality flags, and health flags;
- boot, RTC, schedule, poll, and last-command diagnostics;
- Node `referenceDistanceMm`;
- Gateway reception metadata.

Distance `FFFFFFFF`, temperature `8000`, humidity `FFFF`, and Node reference
zero are normalized to `NULL`. The raw payload preserves their wire encoding.
Unsigned 32-bit values use checked PostgreSQL `BIGINT` columns.

The unique measurement identity is:

```sql
UNIQUE (node_id, node_boot_session_id, node_sequence)
```

`node_boot_session_id` is the storage and public monitoring field for the Node
persistent session. `INSERT ... ON CONFLICT DO NOTHING RETURNING id` makes an
already committed retry return `DUPLICATE`.

Raw ingestion commits before sensor-state recomputation. Missing deployment or
a classifier error cannot reject or roll back valid telemetry; a later packet,
configuration write, or explicit recomputation can recover derived state.

## Authentication and migrations

The Backend stores only the configured SHA-256 digest of the Gateway token.
Generate a local token/digest pair with:

```bash
npm run iot:token
```

Keep the raw value out of source control, logs, shell history, and examples.

Migrations run transactionally under an advisory lock at application startup
and are recorded in `schema_migrations`. Verify the implementation with:

```bash
npm run build
npm run test:unit
npm run test:integration
```

Public monitoring is read-only and bounded; see
[iot-monitoring-api.md](iot-monitoring-api.md).
