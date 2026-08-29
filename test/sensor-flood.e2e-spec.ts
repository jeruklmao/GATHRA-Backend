import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { configureApplication } from '../src/app-bootstrap';
import { DatabaseService } from '../src/database/database.service';
import { FloodModule } from '../src/flood/flood.module';
import { FLOOD_HAZARD_PROVIDER, type FloodHazardProvider } from '../src/flood/flood-hazard.provider';
import { RouteFloodEvaluator } from '../src/flood/geometry/route-flood-evaluator';
import {
  SENSOR_NOW_FN,
  type SensorNowFn,
} from '../src/flood/sensors/sensor-deployment.service';
import { IotModule } from '../src/iot/iot.module';

const ADMIN_TOKEN = '1234567890abcdef'.repeat(4);
const ADMIN_AUTHORIZATION = `Bearer ${ADMIN_TOKEN}`;
const GATEWAY_TOKEN = 'integration-gateway-token';
const GATEWAY_AUTHORIZATION = `Bearer ${GATEWAY_TOKEN}`;
const NODE_ID = 'GTH-10003BD4BCFC';

describe('sensor-backed flood hazards (PostgreSQL integration)', () => {
  const originalEnvironment = {
    enableFloodAdminEndpoints: process.env.ENABLE_FLOOD_ADMIN_ENDPOINTS,
    floodAdminTokenSha256: process.env.FLOOD_ADMIN_TOKEN_SHA256,
    iotGatewayTokenSha256: process.env.IOT_GATEWAY_TOKEN_SHA256,
  };
  let app: INestApplication;
  let database: DatabaseService;
  let now = new Date('2026-08-26T12:00:00.000Z');

  beforeAll(async () => {
    process.env.ENABLE_FLOOD_ADMIN_ENDPOINTS = 'true';
    process.env.FLOOD_ADMIN_TOKEN_SHA256 = createHash('sha256')
      .update(ADMIN_TOKEN)
      .digest('hex');
    process.env.IOT_GATEWAY_TOKEN_SHA256 = createHash('sha256')
      .update(GATEWAY_TOKEN)
      .digest('hex');
    const clock: SensorNowFn = () => now;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [FloodModule.register('sensor'), IotModule],
    })
      .overrideProvider(SENSOR_NOW_FN)
      .useValue(clock)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);
  });

  beforeEach(async () => {
    now = new Date('2026-08-26T12:00:00.000Z');
    await database.query(
      'TRUNCATE iot_sensor_state, iot_sensor_deployments, iot_telemetry, iot_nodes, iot_gateways RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await database.query(
      'TRUNCATE iot_sensor_state, iot_sensor_deployments, iot_telemetry, iot_nodes, iot_gateways RESTART IDENTITY CASCADE',
    );
    await app.close();
    restoreEnvironment(
      'ENABLE_FLOOD_ADMIN_ENDPOINTS',
      originalEnvironment.enableFloodAdminEndpoints,
    );
    restoreEnvironment(
      'FLOOD_ADMIN_TOKEN_SHA256',
      originalEnvironment.floodAdminTokenSha256,
    );
    restoreEnvironment(
      'IOT_GATEWAY_TOKEN_SHA256',
      originalEnvironment.iotGatewayTokenSha256,
    );
  });

  it('reuses flood-admin authentication for all sensor deployment operations', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/iot/sensor-deployments')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/iot/sensor-deployments')
      .set('Authorization', `Bearer ${'f'.repeat(64)}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/iot/sensor-deployments')
      .set('Authorization', ADMIN_AUTHORIZATION)
      .expect(200, { deployments: [] });
  });

  it('atomically validates deployment configuration and geometry', async () => {
    await putDeployment(productionDeployment()).expect(200);

    const invalidCases: object[] = [
      { latitude: 91 },
      { longitude: 181 },
      { expectedPollIntervalMinutes: 0 },
      { staleAfterMinutes: 9 },
      { mediumThresholdMm: 300 },
      { hysteresisMm: 21 },
      { lowMultiplier: -0.01 },
      { mediumMultiplier: 1.01 },
      { highMultiplier: Number.POSITIVE_INFINITY },
      { referenceDistanceOverrideMm: 0 },
      { referenceDistanceOverrideMm: 4_294_967_296 },
      {
        coveragePolygon: {
          type: 'Polygon',
          coordinates: [PRODUCTION_RING.slice(0, -1)],
        },
      },
      {
        latitude: 0.5,
        longitude: 0.5,
        coveragePolygon: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 1],
              [0, 1],
              [1, 0],
              [0, 0],
            ],
          ],
        },
      },
      { latitude: 0, longitude: 0 },
    ];
    for (const overrides of invalidCases) {
      await putDeployment({ ...productionDeployment(), ...overrides }).expect(
        400,
      );
    }

    const persisted = await getDeployment();
    expect(persisted.body.deployment).toMatchObject({
      latitude: -6.235149042111252,
      longitude: 106.72040149114301,
      configVersion: 1,
    });
  });

  it('keeps an enabled UNKNOWN polygon before telemetry and a stable snapshot', async () => {
    const created = await putDeployment(productionDeployment()).expect(200);
    expect(created.body.deployment.state).toMatchObject({
      latestTelemetryId: null,
      waterHeightMm: null,
      classifiedLevel: 'UNKNOWN',
      effectiveLevel: 'UNKNOWN',
      effectiveMultiplier: 1,
      fresh: false,
      freshness: 'NO_TELEMETRY',
      reasonCodes: ['NO_TELEMETRY'],
    });

    const first = await publicHazards();
    const second = await publicHazards();
    expect(first.body).toMatchObject({
      source: 'SENSOR',
      snapshotId: expect.stringMatching(/^sensor_snapshot_/),
      features: [
        {
          id: `sensor_${NODE_ID}`,
          properties: {
            riskLevel: 'UNKNOWN',
            routingMultiplier: 1,
            source: 'SENSOR',
            sourceNodeIds: [NODE_ID],
            reasonCodes: ['NO_TELEMETRY'],
          },
          geometry: {
            type: 'Polygon',
            coordinates: [PRODUCTION_RING],
          },
        },
      ],
    });
    expect(second.body.snapshotId).toBe(first.body.snapshotId);
  });

  it('keeps deployment configuration when raw telemetry and derived state are cleaned', async () => {
    await putDeployment(productionDeployment()).expect(200);
    await database.query('TRUNCATE iot_telemetry CASCADE');

    const counts = await database.query<{
      deployments: string;
      states: string;
    }>(
      `SELECT
        (SELECT COUNT(*)::text FROM iot_sensor_deployments) AS deployments,
        (SELECT COUNT(*)::text FROM iot_sensor_state) AS states`,
    );
    expect(counts.rows[0]).toEqual({ deployments: '1', states: '0' });
    const deployment = await getDeployment();
    expect(deployment.body.deployment).toMatchObject({
      nodeId: NODE_ID,
      configVersion: 1,
      state: {
        effectiveLevel: 'UNKNOWN',
        reasonCodes: ['NO_TELEMETRY'],
      },
    });
  });

  it('recomputes from stored Protocol 3 telemetry and persists derived state', async () => {
    await ingestTelemetry(
      packet({ sequence: 10, acceptedDistanceMm: 1_700 }),
      '2026-08-26T11:50:00.000Z',
    );

    const response = await putDeployment(productionDeployment()).expect(200);
    expect(response.body.deployment).toMatchObject({
      configVersion: 1,
      state: {
        latestTelemetryId: 1,
        referenceDistanceMm: 1_725,
        acceptedDistanceMm: 1_700,
        waterHeightMm: 25,
        classifiedLevel: 'MEDIUM',
        effectiveLevel: 'MEDIUM',
        effectiveMultiplier: 0.35,
        fresh: true,
        freshness: 'FRESH',
        observationSource: 'GATEWAY',
        observedAt: '2026-08-26T11:50:00.000Z',
        validUntil: '2026-08-26T12:20:00.000Z',
        reasonCodes: [],
        classificationConfigVersion: 1,
      },
    });

    const state = await database.query<{
      telemetry_id: string;
      water_height_mm: string;
      classified_level: string;
      effective_multiplier: number;
      classification_config_version: string;
    }>('SELECT * FROM iot_sensor_state WHERE node_id = $1', [NODE_ID]);
    expect(state.rows[0]).toMatchObject({
      telemetry_id: '1',
      water_height_mm: '25',
      classified_level: 'MEDIUM',
      effective_multiplier: 0.35,
      classification_config_version: '1',
    });
  });

  it('increments material config versions, recomputes, and applies multipliers without restart', async () => {
    await ingestTelemetry(
      packet({ sequence: 10, acceptedDistanceMm: 1_700 }),
      '2026-08-26T11:50:00.000Z',
    );
    await putDeployment(productionDeployment()).expect(200);
    const noOp = await putDeployment(productionDeployment()).expect(200);
    expect(noOp.body.deployment.configVersion).toBe(1);

    const updatedConfiguration = {
      ...productionDeployment(),
      mediumMultiplier: 0.7,
    };
    const updated = await putDeployment(updatedConfiguration).expect(200);
    expect(updated.body.deployment).toMatchObject({
      configVersion: 2,
      mediumMultiplier: 0.7,
      state: {
        classifiedLevel: 'MEDIUM',
        effectiveMultiplier: 0.7,
        classificationConfigVersion: 2,
      },
    });

    const hazard = await publicHazards();
    expect(hazard.body.features[0].properties.routingMultiplier).toBe(0.7);
  });

  it('applies and clears a persisted reference override across state, hazards, and public detail', async () => {
    await ingestTelemetry(
      packet({ sequence: 10, acceptedDistanceMm: 1_600 }),
      '2026-08-26T11:50:00.000Z',
    );
    const initial = await putDeployment(productionDeployment()).expect(200);
    expect(initial.body.deployment).toMatchObject({
      referenceDistanceOverrideMm: null,
      state: {
        nodeReferenceDistanceMm: 1_725,
        referenceDistanceMm: 1_725,
        waterHeightMm: 125,
        effectiveLevel: 'MEDIUM',
      },
    });

    const overridden = await putDeployment({
      ...productionDeployment(),
      referenceDistanceOverrideMm: 1_950,
    }).expect(200);
    expect(overridden.body.deployment).toMatchObject({
      referenceDistanceOverrideMm: 1_950,
      configVersion: 2,
      state: {
        nodeReferenceDistanceMm: 1_725,
        referenceDistanceMm: 1_950,
        waterHeightMm: 350,
        effectiveLevel: 'HIGH',
        effectiveMultiplier: 0.05,
      },
    });
    expect((await publicHazards()).body.features[0].properties).toMatchObject({
      riskLevel: 'HIGH',
      routingMultiplier: 0.05,
    });
    const provider = app.get<FloodHazardProvider>(FLOOD_HAZARD_PROVIDER);
    const evaluator = app.get(RouteFloodEvaluator);
    const overriddenSnapshot = await provider.getActiveSnapshot({});
    const overriddenRisk = evaluator.evaluateRoute(
      [[106.7204, -6.2351], [106.721, -6.234]],
      200,
      overriddenSnapshot.hazards,
      overriddenSnapshot.snapshotId,
      now,
    );
    expect(overriddenRisk).toMatchObject({ level: 'HIGH', score: 0.95 });
    const publicDetail = await request(app.getHttpServer())
      .get(`/api/v1/sensors/${NODE_ID}`)
      .expect(200);
    expect(publicDetail.body).toMatchObject({
      nodeId: NODE_ID,
      position: {
        latitude: -6.235149042111252,
        longitude: 106.72040149114301,
      },
      flood: {
        waterHeightMm: 350,
        effectiveLevel: 'HIGH',
        freshness: 'FRESH',
        observedAt: '2026-08-26T11:50:00.000Z',
      },
      measurement: {
        acceptedDistanceMm: 1_600,
        temperatureC: 27,
        humidityPercent: 70,
      },
      gateway: {
        status: 'UNAVAILABLE',
        radioReceptionStatus: 'RECENT',
        latestRssiDbm: -50,
        latestSnrDb: 10,
        backendDeliveryStatus: 'UNAVAILABLE',
      },
    });

    const cleared = await putDeployment(productionDeployment()).expect(200);
    expect(cleared.body.deployment).toMatchObject({
      referenceDistanceOverrideMm: null,
      configVersion: 3,
      state: {
        referenceDistanceMm: 1_725,
        waterHeightMm: 125,
        effectiveLevel: 'MEDIUM',
        effectiveMultiplier: 0.35,
      },
    });
    expect((await publicHazards()).body.features[0].properties).toMatchObject({
      riskLevel: 'MEDIUM',
      routingMultiplier: 0.35,
    });
    const clearedSnapshot = await provider.getActiveSnapshot({});
    const clearedRisk = evaluator.evaluateRoute(
      [[106.7204, -6.2351], [106.721, -6.234]],
      200,
      clearedSnapshot.hazards,
      clearedSnapshot.snapshotId,
      now,
    );
    expect(clearedRisk).toMatchObject({ level: 'MEDIUM', score: 0.65 });
  });

  it('derives after new telemetry and rejects a delayed lower sequence as current', async () => {
    await putDeployment(productionDeployment()).expect(200);
    const firstSnapshot = (await publicHazards()).body.snapshotId;
    await ingestTelemetry(
      packet({ sequence: 20, acceptedDistanceMm: 1_725 }),
      '2026-08-26T11:55:00.000Z',
    );
    const current = await getDeployment();
    expect(current.body.deployment.state).toMatchObject({
      latestTelemetryId: 1,
      waterHeightMm: 0,
      classifiedLevel: 'LOW',
    });
    const telemetrySnapshot = (await publicHazards()).body.snapshotId;
    expect(telemetrySnapshot).not.toBe(firstSnapshot);

    await ingestTelemetry(
      packet({ sequence: 19, acceptedDistanceMm: 925 }),
      '2026-08-26T11:59:00.000Z',
    );
    const afterDelayed = await getDeployment();
    expect(afterDelayed.body.deployment.state).toMatchObject({
      latestTelemetryId: 1,
      waterHeightMm: 0,
      classifiedLevel: 'LOW',
    });
    expect((await publicHazards()).body.snapshotId).toBe(telemetrySnapshot);
  });

  it('changes to stable UNKNOWN exactly once after validUntil without a packet', async () => {
    await ingestTelemetry(
      packet({ sequence: 10, acceptedDistanceMm: 1_725 }),
      '2026-08-26T11:55:00.000Z',
    );
    await putDeployment(productionDeployment()).expect(200);

    now = new Date('2026-08-26T12:25:00.000Z');
    const boundary = await publicHazards();
    expect(boundary.body.features[0].properties).toMatchObject({
      riskLevel: 'LOW',
      freshness: 'FRESH',
    });

    now = new Date('2026-08-26T12:25:00.001Z');
    const stale = await publicHazards();
    const stillStale = await publicHazards();
    expect(stale.body.snapshotId).not.toBe(boundary.body.snapshotId);
    expect(stillStale.body.snapshotId).toBe(stale.body.snapshotId);
    expect(stale.body.features[0].properties).toMatchObject({
      riskLevel: 'UNKNOWN',
      routingMultiplier: 1,
      freshness: 'STALE',
      reasonCodes: ['STALE'],
    });
    expect(stale.body.features).toHaveLength(1);
  });

  function putDeployment(body: object) {
    return request(app.getHttpServer())
      .put(`/api/v1/admin/iot/sensor-deployments/${NODE_ID}`)
      .set('Authorization', ADMIN_AUTHORIZATION)
      .send(body);
  }

  function getDeployment() {
    return request(app.getHttpServer())
      .get(`/api/v1/admin/iot/sensor-deployments/${NODE_ID}`)
      .set('Authorization', ADMIN_AUTHORIZATION)
      .expect(200);
  }

  function publicHazards() {
    return request(app.getHttpServer())
      .get('/api/v1/flood-hazards')
      .expect(200);
  }

  function ingestTelemetry(packetBytes: Buffer, gatewayReceivedAt: string) {
    return request(app.getHttpServer())
      .post('/api/v1/iot/telemetry/batch')
      .set('Authorization', GATEWAY_AUTHORIZATION)
      .send({
        schemaVersion: 1,
        gateway: {
          gatewayId: 'GTH-GW-AABBCCDDEEFF',
          hardwareMac: 'AA:BB:CC:DD:EE:FF',
          firmwareVersion: '3.0.0',
          bootSessionId: 123,
        },
        readings: [
          {
            gatewayReceivedAt,
            gatewayTimeTrusted: true,
            gatewayUptimeMs: 123_456,
            gatewayBootSessionId: 456,
            rssiDbm: -50,
            snrDb: 10,
            frequencyErrorHz: 0,
            packetLength: packetBytes.length,
            rawPayloadBase64: packetBytes.toString('base64'),
          },
        ],
      })
      .expect(200);
  }
});

const PRODUCTION_RING = [
  [106.71611965436333, -6.226351128635932],
  [106.71981261034283, -6.225321294492612],
  [106.72420026443773, -6.226956949557767],
  [106.72652819598396, -6.228701635702763],
  [106.72479753726269, -6.233754051518433],
  [106.72206744340276, -6.235692513426338],
  [106.72038553309565, -6.240054277377989],
  [106.7154736960056, -6.237437240913189],
  [106.71443772129092, -6.232287997746711],
  [106.71611965436333, -6.226351128635932],
];

function productionDeployment() {
  return {
    enabled: true,
    latitude: -6.235149042111252,
    longitude: 106.72040149114301,
    coveragePolygon: {
      type: 'Polygon',
      coordinates: [PRODUCTION_RING],
    },
    referenceDistanceOverrideMm: null,
    expectedPollIntervalMinutes: 10,
    staleAfterMinutes: 30,
    hysteresisMm: 10,
    mediumThresholdMm: 20,
    highThresholdMm: 300,
    blockedThresholdMm: 750,
    lowMultiplier: 1,
    mediumMultiplier: 0.35,
    highMultiplier: 0.05,
    blockedMultiplier: 0,
    unknownMultiplier: 1,
  };
}

function packet(values: {
  readonly sequence: number;
  readonly acceptedDistanceMm: number;
}): Buffer {
  const nodeId = Buffer.from(NODE_ID, 'ascii');
  const packetBytes = Buffer.alloc(5 + nodeId.length + 57);
  packetBytes.set([0x47, 0x54, 3, 1, nodeId.length], 0);
  packetBytes.set(nodeId, 5);
  const offset = 5 + nodeId.length;
  packetBytes.writeUInt32BE(0x0102_0304, offset);
  packetBytes.writeUInt32BE(values.sequence, offset + 4);
  packetBytes.writeUInt32BE(9_900, offset + 8);
  packetBytes.writeUInt32BE(values.acceptedDistanceMm, offset + 12);
  packetBytes.writeUInt32BE(values.acceptedDistanceMm, offset + 16);
  packetBytes.writeUInt16BE(1, offset + 20);
  packetBytes.writeInt16BE(2_700, offset + 22);
  packetBytes.writeUInt16BE(7_000, offset + 24);
  packetBytes.writeUInt16BE(4_000, offset + 26);
  packetBytes[offset + 28] = 7;
  packetBytes[offset + 29] = 7;
  packetBytes[offset + 30] = 0;
  packetBytes.writeUInt16BE(0x0007, offset + 31);
  packetBytes.writeUInt16BE(0, offset + 33);
  packetBytes[offset + 35] = 0;
  packetBytes[offset + 36] = 0;
  packetBytes.writeUInt32BE(1_787_600_000, offset + 37);
  packetBytes[offset + 41] = 10;
  packetBytes[offset + 42] = 0;
  packetBytes.writeUInt32BE(0, offset + 43);
  packetBytes.writeUInt32BE(0, offset + 47);
  packetBytes[offset + 51] = 0;
  packetBytes[offset + 52] = 0xff;
  packetBytes.writeUInt32BE(1_725, offset + 53);
  return packetBytes;
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
