import type { FloodRiskLevel } from '../models/flood-hazard';
import {
  deriveSensorState,
  evaluateEffectiveSensorState,
  selectObservationTime,
} from './sensor-classifier';
import type {
  SensorClassificationStatus,
  SensorDeploymentConfiguration,
  SensorStateRecord,
  SensorTelemetryRecord,
} from './sensor-deployment.models';

describe('sensor flood classifier', () => {
  const now = new Date('2026-08-26T12:00:00.000Z');

  it.each([
    [0, 'LOW'],
    [19, 'LOW'],
    [20, 'MEDIUM'],
    [299, 'MEDIUM'],
    [300, 'HIGH'],
    [749, 'HIGH'],
    [750, 'BLOCKED'],
    [2_000, 'BLOCKED'],
  ] as const)('classifies %i mm as %s without previous state', (water, level) => {
    const state = deriveSensorState({
      deployment: deployment(),
      telemetry: telemetry({
        referenceDistanceMm: 2_000,
        acceptedDistanceMm: 2_000 - water,
      }),
      previousState: null,
      now,
    });

    expect(state.waterHeightMm).toBe(water);
    expect(state.classifiedLevel).toBe(level);
    expect(state.classificationStatus).toBe('VALID');
    expect(state.reasonCodes).toEqual([]);
  });

  it.each([
    ['LOW', 19, 'LOW'],
    ['LOW', 20, 'MEDIUM'],
    ['MEDIUM', 10, 'MEDIUM'],
    ['MEDIUM', 9, 'LOW'],
    ['MEDIUM', 299, 'MEDIUM'],
    ['MEDIUM', 300, 'HIGH'],
    ['HIGH', 290, 'HIGH'],
    ['HIGH', 289, 'MEDIUM'],
    ['HIGH', 749, 'HIGH'],
    ['HIGH', 750, 'BLOCKED'],
    ['BLOCKED', 740, 'BLOCKED'],
    ['BLOCKED', 739, 'HIGH'],
    ['LOW', 800, 'BLOCKED'],
    ['BLOCKED', 0, 'LOW'],
  ] as const)(
    '%s plus %i mm transitions deterministically to %s',
    (previousLevel, water, expected) => {
      const config = deployment();
      const state = deriveSensorState({
        deployment: config,
        telemetry: telemetry({
          id: 2,
          referenceDistanceMm: 2_000,
          acceptedDistanceMm: 2_000 - water,
        }),
        previousState: previousState(previousLevel),
        now,
      });
      expect(state.classifiedLevel).toBe(expected);
    },
  );

  it.each([
    [null, 1_000, ['REFERENCE_DISTANCE_MISSING']],
    [1_725, null, ['ACCEPTED_DISTANCE_MISSING']],
    [null, null, ['REFERENCE_DISTANCE_MISSING', 'ACCEPTED_DISTANCE_MISSING']],
  ] as const)(
    'returns UNKNOWN for reference=%s accepted=%s',
    (referenceDistanceMm, acceptedDistanceMm, expectedReasons) => {
      const state = deriveSensorState({
        deployment: deployment(),
        telemetry: telemetry({ referenceDistanceMm, acceptedDistanceMm }),
        previousState: null,
        now,
      });
      expect(state).toMatchObject({
        waterHeightMm: null,
        classifiedLevel: 'UNKNOWN',
        classificationStatus: 'UNKNOWN',
        effectiveMultiplier: 1,
      });
      expect(state.reasonCodes).toEqual(expect.arrayContaining(expectedReasons));
    },
  );

  it('clamps an accepted distance above reference to zero water height', () => {
    const state = deriveSensorState({
      deployment: deployment(),
      telemetry: telemetry({
        referenceDistanceMm: 1_725,
        acceptedDistanceMm: 1_800,
      }),
      previousState: null,
      now,
    });
    expect(state).toMatchObject({ waterHeightMm: 0, classifiedLevel: 'LOW' });
  });

  it.each([2, 3, 6, 7])(
    'rejects unusable filter state %i conservatively',
    (filterState) => {
      const state = deriveSensorState({
        deployment: deployment(),
        telemetry: telemetry({ filterState }),
        previousState: null,
        now,
      });
      expect(state.classifiedLevel).toBe('UNKNOWN');
      expect(state.reasonCodes).toContain('FILTER_INVALID');
    },
  );

  it('uses a retained accepted value for TRANSIENT_REJECTED', () => {
    const state = deriveSensorState({
      deployment: deployment(),
      telemetry: telemetry({
        filterState: 4,
        healthFlags: 1 << 7,
        acceptedDistanceMm: 1_000,
      }),
      previousState: null,
      now,
    });
    expect(state).toMatchObject({
      waterHeightMm: 725,
      classifiedLevel: 'HIGH',
      classificationStatus: 'VALID',
    });
  });

  it.each([1 << 0, 1 << 8, 1 << 9])(
    'rejects unusable sonar/calibration health flag 0x%s',
    (healthFlags) => {
      const state = deriveSensorState({
        deployment: deployment(),
        telemetry: telemetry({ healthFlags }),
        previousState: null,
        now,
      });
      expect(state.classifiedLevel).toBe('UNKNOWN');
      expect(state.reasonCodes).toContain('SENSOR_UNHEALTHY');
    },
  );

  it('rejects an accepted value without the accepted-distance quality bit', () => {
    const state = deriveSensorState({
      deployment: deployment(),
      telemetry: telemetry({ qualityFlags: 0 }),
      previousState: null,
      now,
    });
    expect(state.classifiedLevel).toBe('UNKNOWN');
    expect(state.reasonCodes).toContain('SENSOR_UNHEALTHY');
  });

  it('classifies directly after previous UNKNOWN', () => {
    const state = deriveSensorState({
      deployment: deployment(),
      telemetry: telemetry({ id: 2, acceptedDistanceMm: 1_710 }),
      previousState: previousState('UNKNOWN', 'UNKNOWN'),
      now,
    });
    expect(state.classifiedLevel).toBe('LOW');
  });

  it('classifies directly after the previous state became stale', () => {
    const previous = previousState('MEDIUM');
    const state = deriveSensorState({
      deployment: deployment(),
      telemetry: telemetry({ id: 2, acceptedDistanceMm: 1_710 }),
      previousState: {
        ...previous,
        validUntil: new Date(now.getTime() - 1),
      },
      now,
    });
    expect(state.classifiedLevel).toBe('LOW');
  });

  it('classifies directly when the configuration version changes', () => {
    const state = deriveSensorState({
      deployment: deployment({ configVersion: 2 }),
      telemetry: telemetry({ id: 2, acceptedDistanceMm: 1_710 }),
      previousState: previousState('MEDIUM'),
      now,
    });
    expect(state.classifiedLevel).toBe('LOW');
    expect(state.classificationConfigVersion).toBe(2);
  });

  it('classifies directly when a deployment is first enabled', () => {
    const state = deriveSensorState({
      deployment: deployment({ configVersion: 2, enabled: true }),
      telemetry: telemetry({ id: 2, acceptedDistanceMm: 1_710 }),
      previousState: previousState('UNKNOWN', 'DISABLED'),
      now,
    });
    expect(state.classifiedLevel).toBe('LOW');
  });

  it('uses the configured multiplier for the classified level', () => {
    const state = deriveSensorState({
      deployment: deployment({ mediumMultiplier: 0.7 }),
      telemetry: telemetry({ acceptedDistanceMm: 1_700 }),
      previousState: null,
      now,
    });
    expect(state).toMatchObject({
      classifiedLevel: 'MEDIUM',
      effectiveMultiplier: 0.7,
    });
  });

  it('uses a trusted valid Gateway timestamp', () => {
    expect(selectObservationTime(telemetry())).toEqual({
      observedAt: new Date('2026-08-26T11:45:00.000Z'),
      source: 'GATEWAY',
    });
  });

  it.each([
    [false, new Date('2026-08-26T11:45:00.000Z')],
    [true, null],
    [true, new Date(Number.NaN)],
  ] as const)(
    'falls back to server time for trusted=%s gateway=%s',
    (gatewayTimeTrusted, gatewayReceivedAt) => {
      expect(
        selectObservationTime(
          telemetry({ gatewayTimeTrusted, gatewayReceivedAt }),
        ),
      ).toEqual({
        observedAt: new Date('2026-08-26T11:46:00.000Z'),
        source: 'SERVER',
      });
    },
  );

  it.each([
    ['2026-08-26T12:14:59.999Z', 'FRESH', 'MEDIUM'],
    ['2026-08-26T12:15:00.000Z', 'FRESH', 'MEDIUM'],
    ['2026-08-26T12:15:00.001Z', 'STALE', 'UNKNOWN'],
  ] as const)(
    'evaluates %s as %s with effective level %s',
    (currentTime, freshness, effectiveLevel) => {
      const config = deployment();
      const state = deriveSensorState({
        deployment: config,
        telemetry: telemetry(),
        previousState: null,
        now,
      });
      const effective = evaluateEffectiveSensorState(
        { deployment: config, state: asPersisted(state) },
        new Date(currentTime),
      );
      expect(effective).toMatchObject({ freshness, effectiveLevel });
      if (freshness === 'STALE') {
        expect(effective.reasonCodes).toContain('STALE');
        expect(effective.effectiveMultiplier).toBe(1);
      }
    },
  );
});

function deployment(
  overrides: Partial<SensorDeploymentConfiguration> = {},
): SensorDeploymentConfiguration {
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
    ...overrides,
  };
}

function telemetry(
  overrides: Partial<SensorTelemetryRecord> = {},
): SensorTelemetryRecord {
  return {
    id: 1,
    nodeId: 'GTH-10003BD4BCFC',
    persistentSessionId: 10,
    sequence: 100,
    gatewayReceivedAt: new Date('2026-08-26T11:45:00.000Z'),
    gatewayTimeTrusted: true,
    serverReceivedAt: new Date('2026-08-26T11:46:00.000Z'),
    referenceDistanceMm: 1_725,
    acceptedDistanceMm: 1_700,
    filterState: 0,
    qualityFlags: 1 << 2,
    healthFlags: 0,
    ...overrides,
  };
}

function previousState(
  level: FloodRiskLevel,
  status: SensorClassificationStatus = 'VALID',
): SensorStateRecord {
  return {
    nodeId: 'GTH-10003BD4BCFC',
    telemetryId: 1,
    observedAt: new Date('2026-08-26T11:45:00.000Z'),
    observationSource: 'GATEWAY',
    validUntil: new Date('2026-08-26T12:15:00.000Z'),
    referenceDistanceMm: 1_725,
    acceptedDistanceMm: 1_700,
    waterHeightMm: level === 'UNKNOWN' ? null : 25,
    classifiedLevel: level,
    classificationStatus: status,
    effectiveMultiplier: level === 'MEDIUM' ? 0.35 : 1,
    reasonCodes: level === 'UNKNOWN' ? ['FILTER_INVALID'] : [],
    classificationConfigVersion: 1,
    createdAt: new Date('2026-08-26T11:45:00.000Z'),
    updatedAt: new Date('2026-08-26T11:45:00.000Z'),
  };
}

function asPersisted(
  state: ReturnType<typeof deriveSensorState>,
): SensorStateRecord {
  return {
    ...state,
    createdAt: new Date('2026-08-26T11:45:00.000Z'),
    updatedAt: new Date('2026-08-26T11:45:00.000Z'),
  };
}
