import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app-bootstrap';
import { DatabaseService } from '../src/database/database.service';
import { runMigrations } from '../src/database/migration-runner';
import {
  GEOCODING_PROVIDER,
  type GeocodingProvider,
} from '../src/geocoding/geocoding-provider';
import {
  ROUTING_PROVIDER,
  type RoutingProvider,
} from '../src/routes/routing-provider';

const RAW_TOKEN = 'integration-gateway-token';
const AUTHORIZATION = `Bearer ${RAW_TOKEN}`;
process.env.IOT_GATEWAY_TOKEN_SHA256 = createHash('sha256')
  .update(RAW_TOKEN)
  .digest('hex');

// Exact deployed-Node codec vector from GATHRA-Node/test/test_main.cpp.
const NODE_GOLDEN = Buffer.from([
  0x47, 0x54, 0x02, 0x01, 0x02, 0x4e, 0x31,
  0x01, 0x02, 0x03, 0x04, 0xa0, 0xb0, 0xc0, 0xd0,
  0x00, 0x00, 0x12, 0x34, 0x00, 0x00, 0x02, 0xe4,
  0x00, 0x00, 0x02, 0xe3, 0x00, 0x03, 0xfb, 0x2e,
  0x11, 0xd7, 0x0e, 0x74, 0x07, 0x07, 0x00, 0x00,
  0x03, 0x02, 0x02, 0x00, 0x00, 0x69, 0xab, 0xcd,
  0xef, 0x0a, 0x01, 0x69, 0xab, 0xf0, 0x00, 0x01,
  0x02, 0x03, 0x05, 0x03, 0x00,
]);

describe('IoT raw telemetry persistence (PostgreSQL integration)', () => {
  let app: INestApplication;
  let database: DatabaseService;

  beforeAll(async () => {
    const routingProvider = {
      preview: jest.fn(),
      health: jest.fn().mockResolvedValue(undefined),
    } as unknown as RoutingProvider;
    const geocodingProvider = {
      autocomplete: jest.fn(),
      search: jest.fn(),
      lookup: jest.fn(),
      reverse: jest.fn(),
      health: jest.fn().mockResolvedValue(undefined),
    } as unknown as GeocodingProvider;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ROUTING_PROVIDER)
      .useValue(routingProvider)
      .overrideProvider(GEOCODING_PROVIDER)
      .useValue(geocodingProvider)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);
  });

  beforeEach(async () => {
    await database.query(
      'TRUNCATE iot_telemetry, iot_nodes, iot_gateways RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires the exact Gateway Bearer token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/iot/gateway/ping')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/iot/gateway/ping')
      .set('Authorization', 'Bearer wrong')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/iot/gateway/ping')
      .set('Authorization', AUTHORIZATION)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          status: 'ok',
          ingestionSchemaVersion: 1,
          nodeProtocolVersion: 2,
          maximumBatchSize: 50,
        });
      });
  });

  it('requires an explicit UTC Gateway receive timestamp when time is trusted', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/iot/telemetry/batch')
      .set('Authorization', AUTHORIZATION)
      .send(
        batch([
          reading(NODE_GOLDEN, {
            gatewayReceivedAt: '2026-08-18T05:00:00.123',
          }),
        ]),
      )
      .expect(400);
  });

  it('serializes concurrent migration runners and records each migration once', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await Promise.all([runMigrations(pool), runMigrations(pool)]);
      const ledger = await pool.query<{ name: string }>(
        'SELECT name FROM schema_migrations ORDER BY name',
      );
      expect(ledger.rows).toEqual([
        { name: '001_iot_raw_telemetry.sql' },
        { name: '002_protocol_v2_telemetry.sql' },
      ]);
    } finally {
      await pool.end();
    }
  });

  it('persists exact BYTEA, decoded uint32 fields, Gateway identity, and reception metadata', async () => {
    const body = batch([reading(NODE_GOLDEN)]);
    const response = await ingest(body);

    expect(response.body.results).toEqual([
      {
        index: 0,
        nodeId: 'N1',
        bootSessionId: 0x0102_0304,
        sequence: 0xa0b0_c0d0,
        status: 'INSERTED',
      },
    ]);
    const persisted = await database.query<{
      raw_payload: Buffer;
      node_sequence: string;
      median_echo_us: string;
      hardware_mac: string;
      gateway_logical_id_snapshot: string;
      gateway_received_at: Date;
      gateway_time_trusted: boolean;
      gateway_boot_session_id: string;
      rssi_dbm: number;
      snr_db: number;
    }>(
      `
        SELECT t.raw_payload, t.node_sequence, t.median_echo_us,
               g.hardware_mac, t.gateway_logical_id_snapshot,
               t.gateway_received_at, t.gateway_time_trusted,
               t.gateway_boot_session_id,
               t.rssi_dbm, t.snr_db
        FROM iot_telemetry t JOIN iot_gateways g ON g.id = t.gateway_id
      `,
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0].raw_payload).toEqual(NODE_GOLDEN);
    expect(Number(persisted.rows[0].node_sequence)).toBe(0xa0b0_c0d0);
    expect(Number(persisted.rows[0].median_echo_us)).toBe(0x1234);
    expect(persisted.rows[0].hardware_mac).toBe('AA:BB:CC:DD:EE:FF');
    expect(persisted.rows[0].gateway_logical_id_snapshot).toBe(
      'GTH-GW-AABBCCDDEEFF',
    );
    expect(persisted.rows[0].gateway_time_trusted).toBe(true);
    expect(Number(persisted.rows[0].gateway_boot_session_id)).toBe(
      1_234_567_800,
    );
    expect(persisted.rows[0].gateway_received_at.toISOString()).toBe(
      '2026-08-18T05:00:00.123Z',
    );
    expect(persisted.rows[0].rssi_dbm).toBeCloseTo(-91.5);
    expect(persisted.rows[0].snr_db).toBeCloseTo(8.25);
  });

  it('normalizes sensor sentinels to SQL NULL while retaining raw bytes and flags', async () => {
    const sentinel = packet({
      sequence: 7,
      rawDistanceMm: 0xffff_ffff,
      acceptedDistanceMm: 0xffff_ffff,
      temperatureCentiC: -0x8000,
      humidityCentiPercent: 0xffff,
    });
    await ingest(batch([reading(sentinel)]));

    const persisted = await database.query<{
      raw_distance_mm: string | null;
      accepted_distance_mm: string | null;
      temperature_centi_c: number | null;
      humidity_centi_percent: number | null;
      quality_flags: number;
      health_flags: number;
      raw_payload: Buffer;
    }>('SELECT * FROM iot_telemetry');
    expect(persisted.rows[0]).toMatchObject({
      raw_distance_mm: null,
      accepted_distance_mm: null,
      temperature_centi_c: null,
      humidity_centi_percent: null,
      quality_flags: 7,
      health_flags: 128,
    });
    expect(persisted.rows[0].raw_payload).toEqual(sentinel);
  });

  it('deduplicates atomically by Node ID, boot session, and sequence', async () => {
    const payload = batch([reading(NODE_GOLDEN)]);
    expect((await ingest(payload)).body.results[0].status).toBe('INSERTED');
    expect((await ingest(payload)).body.results[0].status).toBe('DUPLICATE');
    const count = await database.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM iot_telemetry',
    );
    expect(count.rows[0].count).toBe('1');
  });

  it('returns per-record new, duplicate, and permanent invalid results in one batch', async () => {
    await ingest(batch([reading(NODE_GOLDEN)]));
    const next = withSequence(NODE_GOLDEN, 0xa0b0_c0d1);
    const invalid = Buffer.from(NODE_GOLDEN);
    invalid[0] = 0;
    const response = await ingest(
      batch([reading(NODE_GOLDEN), reading(next), reading(invalid)]),
    );

    expect(
      response.body.results.map((item: { status: string }) => item.status),
    ).toEqual(['DUPLICATE', 'INSERTED', 'REJECTED_INVALID']);
    expect(response.body.results[2].reason).toMatch(/^BAD_MAGIC:/);
    const count = await database.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM iot_telemetry',
    );
    expect(count.rows[0].count).toBe('2');
  });

  it('serves frontend-friendly latest/history data with bounded pagination and raw opt-in', async () => {
    const unavailable = packet({
      sequence: 101,
      rawDistanceMm: 0xffff_ffff,
      acceptedDistanceMm: 0xffff_ffff,
      temperatureCentiC: -0x8000,
      humidityCentiPercent: 0xffff,
    });
    await ingest(
      batch([
        reading(withSequence(NODE_GOLDEN, 99)),
        reading(withSequence(NODE_GOLDEN, 100), {
          gatewayReceivedAt: null,
          gatewayTimeTrusted: false,
          gatewayUptimeMs: 123_500,
        }),
        reading(unavailable, {
          gatewayReceivedAt: null,
          gatewayTimeTrusted: false,
          gatewayUptimeMs: 123_600,
        }),
      ]),
    );
    await database.query(
      `
        UPDATE iot_telemetry
        SET server_received_at = CASE node_sequence
          WHEN 99 THEN TIMESTAMPTZ '2026-08-16T00:00:00.000Z'
          WHEN 100 THEN TIMESTAMPTZ '2026-08-17T00:00:00.000Z'
          WHEN 101 THEN TIMESTAMPTZ '2026-08-18T00:00:00.000Z'
        END
      `,
    );

    const list = await request(app.getHttpServer())
      .get('/api/v1/iot/nodes')
      .set('Origin', 'https://gathra.my.id')
      .expect(200);
    expect(list.headers['access-control-allow-origin']).toBe(
      'https://gathra.my.id',
    );
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      nodeId: 'N1',
      lastGateway: {
        gatewayId: 'GTH-GW-AABBCCDDEEFF',
        hardwareMac: 'AA:BB:CC:DD:EE:FF',
      },
      latestTelemetry: {
        sequence: 101,
        measurement: {
          rawDistanceMm: null,
          acceptedDistanceMm: null,
          temperatureC: null,
          humidityPercent: null,
          filterState: { code: 4, name: 'TRANSIENT_REJECTED' },
        },
      },
    });
    expect(list.body[0].firstSeenAt).toEqual(expect.any(String));
    expect(list.body[0].lastSeenAt).toEqual(expect.any(String));

    const detail = await request(app.getHttpServer())
      .get('/api/v1/iot/nodes/N1')
      .expect(200);
    expect(detail.body.latestTelemetry.sequence).toBe(101);

    const firstPage = await request(app.getHttpServer())
      .get('/api/v1/iot/nodes/N1/telemetry')
      .query({ limit: 2 })
      .expect(200);
    expect(
      firstPage.body.items.map((item: { sequence: number }) => item.sequence),
    ).toEqual([101, 100]);
    expect(firstPage.body.nextBeforeId).toEqual(expect.any(Number));
    expect(firstPage.body.items[0].rawPayloadBase64).toBeUndefined();
    expect(firstPage.body.items[0].reception.gatewayReceivedAt).toBeNull();
    expect(firstPage.body.items[0].reception.gatewayTimeTrusted).toBe(false);

    const secondPage = await request(app.getHttpServer())
      .get('/api/v1/iot/nodes/N1/telemetry')
      .query({ limit: 2, beforeId: firstPage.body.nextBeforeId })
      .expect(200);
    expect(
      secondPage.body.items.map((item: { sequence: number }) => item.sequence),
    ).toEqual([99]);
    expect(secondPage.body.nextBeforeId).toBeNull();

    const raw = await request(app.getHttpServer())
      .get('/api/v1/iot/nodes/N1/telemetry')
      .query({ limit: 1, includeRaw: true })
      .expect(200);
    expect(raw.body.items[0].rawPayloadBase64).toBe(
      unavailable.toString('base64'),
    );

    const filtered = await request(app.getHttpServer())
      .get('/api/v1/iot/nodes/N1/telemetry')
      .query({
        from: '2026-08-17T00:00:00.000Z',
        to: '2026-08-17T23:59:59.999Z',
      })
      .expect(200);
    expect(
      filtered.body.items.map((item: { sequence: number }) => item.sequence),
    ).toEqual([100]);

    await request(app.getHttpServer())
      .get('/api/v1/iot/nodes/N1/telemetry')
      .query({
        from: '2026-08-19T00:00:00.000Z',
        to: '2026-08-18T00:00:00.000Z',
      })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/iot/nodes/N1/telemetry')
      .query({ limit: 1001 })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/iot/nodes/N1/telemetry')
      .query({ beforeId: Number.MAX_SAFE_INTEGER + 1 })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/iot/nodes/UNKNOWN')
      .expect(404);

    const disallowedOrigin = await request(app.getHttpServer())
      .get('/api/v1/iot/nodes')
      .set('Origin', 'https://example.invalid')
      .expect(200);
    expect(
      disallowedOrigin.headers['access-control-allow-origin'],
    ).toBeUndefined();
  });

  function ingest(body: unknown): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/api/v1/iot/telemetry/batch')
      .set('Authorization', AUTHORIZATION)
      .send(body as object)
      .expect(200);
  }
});

function batch(readings: unknown[]): object {
  return {
    schemaVersion: 1,
    gateway: {
      gatewayId: 'GTH-GW-AABBCCDDEEFF',
      hardwareMac: 'aa:bb:cc:dd:ee:ff',
      firmwareVersion: '2.0.0',
      bootSessionId: 1_234_567_890,
    },
    readings,
  };
}

function reading(packetBytes: Buffer, overrides: object = {}): object {
  return {
    gatewayReceivedAt: '2026-08-18T05:00:00.123Z',
    gatewayTimeTrusted: true,
    gatewayUptimeMs: 123_456,
    gatewayBootSessionId: 1_234_567_800,
    rssiDbm: -91.5,
    snrDb: 8.25,
    frequencyErrorHz: -731,
    packetLength: packetBytes.length,
    rawPayloadBase64: packetBytes.toString('base64'),
    ...overrides,
  };
}

function withSequence(source: Buffer, sequence: number): Buffer {
  const copy = Buffer.from(source);
  copy.writeUInt32BE(sequence, 11);
  return copy;
}

function packet(values: {
  sequence: number;
  rawDistanceMm: number;
  acceptedDistanceMm: number;
  temperatureCentiC: number;
  humidityCentiPercent: number;
}): Buffer {
  const packetBytes = Buffer.alloc(60);
  packetBytes.set([0x47, 0x54, 2, 1, 2, 0x4e, 0x31], 0);
  const offset = 7;
  packetBytes.writeUInt32BE(0x0102_0304, offset);
  packetBytes.writeUInt32BE(values.sequence, offset + 4);
  packetBytes.writeUInt32BE(4321, offset + 8);
  packetBytes.writeUInt32BE(values.rawDistanceMm, offset + 12);
  packetBytes.writeUInt32BE(values.acceptedDistanceMm, offset + 16);
  packetBytes.writeUInt16BE(3, offset + 20);
  packetBytes.writeInt16BE(values.temperatureCentiC, offset + 22);
  packetBytes.writeUInt16BE(values.humidityCentiPercent, offset + 24);
  packetBytes.writeUInt16BE(4012, offset + 26);
  packetBytes.set([7, 7, 4], offset + 28);
  packetBytes.writeUInt16BE(7, offset + 31);
  packetBytes.writeUInt16BE(128, offset + 33);
  packetBytes[offset + 35] = 0; // RTC_TIMER
  packetBytes[offset + 36] = 0; // RTC VALID
  packetBytes.writeUInt32BE(1_787_600_000, offset + 37);
  packetBytes[offset + 41] = 10;
  packetBytes[offset + 42] = 0; // no pending maintenance
  packetBytes.writeUInt32BE(0, offset + 43);
  packetBytes.writeUInt32BE(0, offset + 47);
  packetBytes[offset + 51] = 0;
  packetBytes[offset + 52] = 0xff;
  return packetBytes;
}
