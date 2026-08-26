import {
  evaluateEffectiveSensorState,
} from '../sensors/sensor-classifier';
import type {
  SensorDeploymentConfiguration,
  SensorDeploymentWithState,
  SensorStateRecord,
} from '../sensors/sensor-deployment.models';
import type { SensorDeploymentService } from '../sensors/sensor-deployment.service';
import { SensorFloodHazardProvider } from './sensor-flood-hazard.provider';

describe('SensorFloodHazardProvider', () => {
  let now: Date;
  let record: SensorDeploymentWithState;
  let provider: SensorFloodHazardProvider;

  beforeEach(() => {
    now = new Date('2026-08-26T12:00:00.000Z');
    record = { deployment: deployment(), state: sensorState() };
    const service = {
      listEffective: jest.fn((at: Date) =>
        Promise.resolve([evaluateEffectiveSensorState(record, at)]),
      ),
    } as unknown as SensorDeploymentService;
    provider = new SensorFloodHazardProvider(service, () => now);
  });

  it('returns a stable SENSOR snapshot and retains a LOW polygon', async () => {
    const first = await provider.getActiveSnapshot({});
    const second = await provider.getActiveSnapshot({});

    expect(first.snapshotId).toBe(second.snapshotId);
    expect(first.snapshotId).toMatch(/^sensor_snapshot_[a-f0-9]{24}$/);
    expect(first.source).toBe('SENSOR');
    expect(first.hazards).toHaveLength(1);
    expect(first.hazards[0]).toMatchObject({
      id: 'sensor_GTH-10003BD4BCFC',
      level: 'LOW',
      routingMultiplier: 1,
      sourceNodeIds: ['GTH-10003BD4BCFC'],
      freshness: 'FRESH',
    });
    expect(first.hazards[0].geometry).toEqual(
      record.deployment.coveragePolygon,
    );
  });

  it('changes identity once at the fresh-to-stale deadline crossing', async () => {
    now = new Date('2026-08-26T12:15:00.000Z');
    const boundary = await provider.getActiveSnapshot({});
    expect(boundary.hazards[0].level).toBe('LOW');

    now = new Date('2026-08-26T12:15:00.001Z');
    const stale = await provider.getActiveSnapshot({});
    const stillStale = await provider.getActiveSnapshot({});

    expect(stale.snapshotId).not.toBe(boundary.snapshotId);
    expect(stale.snapshotId).toBe(stillStale.snapshotId);
    expect(stale.validUntil).toBeNull();
    expect(stale.hazards[0]).toMatchObject({
      level: 'UNKNOWN',
      routingMultiplier: 1,
      freshness: 'STALE',
      reasonCodes: ['STALE'],
    });
  });

  it('changes identity for new telemetry and material configuration versions', async () => {
    const first = await provider.getActiveSnapshot({});
    record = {
      ...record,
      state: { ...record.state!, telemetryId: 2 },
    };
    const telemetryChanged = await provider.getActiveSnapshot({});
    record = {
      deployment: { ...record.deployment, configVersion: 2 },
      state: {
        ...record.state!,
        classificationConfigVersion: 2,
      },
    };
    const configChanged = await provider.getActiveSnapshot({});

    expect(telemetryChanged.snapshotId).not.toBe(first.snapshotId);
    expect(configChanged.snapshotId).not.toBe(telemetryChanged.snapshotId);
  });

  it('retains an UNKNOWN no-telemetry polygon', async () => {
    record = { deployment: deployment(), state: null };
    const snapshot = await provider.getActiveSnapshot({});
    expect(snapshot.hazards).toHaveLength(1);
    expect(snapshot.hazards[0]).toMatchObject({
      level: 'UNKNOWN',
      observedAt: null,
      validUntil: null,
      routingMultiplier: 1,
      reasonCodes: ['NO_TELEMETRY'],
    });
  });

  it.each([
    ['LOW', 1],
    ['MEDIUM', 0.35],
    ['HIGH', 0.05],
    ['BLOCKED', 0],
    ['UNKNOWN', 1],
  ] as const)('emits a polygon for effective %s', async (level, multiplier) => {
    record = {
      deployment: deployment(),
      state: {
        ...sensorState(),
        classifiedLevel: level,
        classificationStatus: level === 'UNKNOWN' ? 'UNKNOWN' : 'VALID',
        effectiveMultiplier: multiplier,
        reasonCodes: level === 'UNKNOWN' ? ['FILTER_INVALID'] : [],
      },
    };
    const snapshot = await provider.getActiveSnapshot({});
    expect(snapshot.hazards).toHaveLength(1);
    expect(snapshot.hazards[0]).toMatchObject({
      level,
      routingMultiplier: multiplier,
    });
  });

  it('omits a disabled polygon but includes it in deterministic identity', async () => {
    record = {
      deployment: { ...deployment(), enabled: false, configVersion: 2 },
      state: { ...sensorState(), classificationConfigVersion: 2 },
    };
    const first = await provider.getActiveSnapshot({});
    record = {
      deployment: { ...record.deployment, configVersion: 3 },
      state: { ...record.state!, classificationConfigVersion: 3 },
    };
    const changed = await provider.getActiveSnapshot({});
    expect(first.hazards).toEqual([]);
    expect(changed.snapshotId).not.toBe(first.snapshotId);
  });
});

function deployment(): SensorDeploymentConfiguration {
  return {
    nodeId: 'GTH-10003BD4BCFC',
    enabled: true,
    latitude: -6.235,
    longitude: 106.72,
    coveragePolygon: {
      type: 'Polygon',
      coordinates: [
        [
          [106.71, -6.24],
          [106.73, -6.24],
          [106.73, -6.22],
          [106.71, -6.22],
          [106.71, -6.24],
        ],
      ],
    },
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
    configVersion: 1,
    createdAt: new Date('2026-08-26T00:00:00.000Z'),
    updatedAt: new Date('2026-08-26T00:00:00.000Z'),
  };
}

function sensorState(): SensorStateRecord {
  return {
    nodeId: 'GTH-10003BD4BCFC',
    telemetryId: 1,
    observedAt: new Date('2026-08-26T11:45:00.000Z'),
    observationSource: 'GATEWAY',
    validUntil: new Date('2026-08-26T12:15:00.000Z'),
    referenceDistanceMm: 1_725,
    acceptedDistanceMm: 1_725,
    waterHeightMm: 0,
    classifiedLevel: 'LOW',
    classificationStatus: 'VALID',
    effectiveMultiplier: 1,
    reasonCodes: [],
    classificationConfigVersion: 1,
    createdAt: new Date('2026-08-26T11:45:00.000Z'),
    updatedAt: new Date('2026-08-26T11:45:00.000Z'),
  };
}
