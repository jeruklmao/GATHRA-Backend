# IoT raw telemetry persistence

This module stops at exact Node telemetry persistence and read-only monitoring.
It does not infer flood severity, sensor coordinates, installation datum, road
coverage, or `FloodHazard` geometry.

## Local PostgreSQL

The normal Compose stack runs pinned `postgres:17-alpine` with a persistent
`postgres-data` named volume and healthcheck. Backend startup waits for a
healthy database. Set non-default production credentials outside Git.

```bash
cp .env.example .env
docker compose up --build --wait
docker compose ps
```

For tests, `npm run test:integration` starts the isolated service in
`compose.test.yaml` on loopback port 55432, runs real migrations and all e2e
tests, then removes that disposable test instance.

Host-side configuration uses:

```text
DATABASE_URL=postgresql://user:password@host:5432/database
IOT_GATEWAY_TOKEN_SHA256=<64 lowercase/uppercase hex characters>
IOT_MAX_BATCH_SIZE=50
IOT_MONITOR_MAX_LIMIT=1000
IOT_MONITOR_ALLOWED_ORIGINS=https://gathra.my.id
```

## Gateway credential

```bash
npm run iot:token
```

The utility prints a random 256-bit Base64url token once and its SHA-256 digest.
Provision the raw token into Gateway NVS. Put only the digest in Backend
environment configuration. The guard hashes presented Bearer values and uses
constant-time digest comparison. Missing/wrong credentials return 401; no
configured digest fails closed with 503. Tokens are not logged.

This is one static Gateway credential in v1, not a credential database or
multi-tenant authorization model.

## Migrations

At application bootstrap, `src/database/migration-runner.ts`:

1. acquires a PostgreSQL advisory lock;
2. creates the migration ledger if necessary;
3. reads ordered `database/migrations/NNN_name.sql` files;
4. runs each unapplied migration transactionally;
5. records its filename in `schema_migrations`;
6. releases the lock.

Repeated or concurrent startup is safe. Request handlers never create schema.

```bash
docker compose exec postgres psql -U "${POSTGRES_USER:-gathra}" \
  -d "${POSTGRES_DB:-gathra}" -c 'TABLE schema_migrations;'
docker compose exec postgres psql -U "${POSTGRES_USER:-gathra}" \
  -d "${POSTGRES_DB:-gathra}" -c '\d+ iot_telemetry'
```

## Tables and identity

- `iot_gateways`: stable unique hardware MAC, current editable logical ID,
  firmware version, first/last seen.
- `iot_nodes`: Node ID, first/last seen, last reporting Gateway reference.
- `iot_telemetry`: decoded measurements, reception metadata, capture-time
  Gateway boot ID, server receive time, logical Gateway-ID snapshot, and exact
  raw packet `BYTEA`.

Unsigned Node/Gateway 32-bit values use checked `BIGINT`, not PostgreSQL signed
`INTEGER`. Raw/accepted-distance `UINT32_MAX`, temperature `INT16_MIN`, and
humidity `UINT16_MAX` become SQL `NULL`; flags and raw bytes remain intact.

The mandatory unique constraint is:

```sql
UNIQUE (node_id, node_boot_session_id, node_sequence)
```

`INSERT ... ON CONFLICT DO NOTHING RETURNING id` makes concurrent/repeated
delivery idempotent. A retry after a committed-but-lost HTTP response returns
`DUPLICATE` and leaves one row.

Indexes support latest/history by Node and history by Gateway. Raw telemetry is
not automatically deleted in v1. Define retention/downsampling later based on
deployment volume; do not treat this as an implicit unlimited-storage promise.

## Ingestion contract

`POST /api/v1/iot/telemetry/batch` accepts 1–50 readings and requires Gateway
Bearer authentication. Each reading carries exact canonical Base64, declared
packet length, receive time/trust pair, receive uptime, capture-time Gateway
boot ID, RSSI, SNR, and frequency error.

NestJS independently validates canonical Base64, 96-byte radio capacity, `GT`
magic, version/type, Node-ID bytes and length, exact framing/no trailing bytes,
filter state, and packet-length consistency. ACK packets are not telemetry.
Unknown quality/health bits are preserved.

Invalid packet records receive `REJECTED_INVALID` without preventing valid
records in the same batch. Database unavailability/errors fail the request so
the Gateway retains the batch.

The authenticated `GET /api/v1/iot/gateway/ping` checks authentication, API
versions, configured batch maximum, and a live database query without touching
queue or telemetry data.

## Health and isolation

`GET /api/v1/health` exposes PostgreSQL alongside routing and geocoding
readiness; DB failure is not hidden. `src/iot` and `src/database` remain
separate from routing and the simulated flood provider. No telemetry-to-flood
conversion exists in this milestone.
