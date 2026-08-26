import type { FloodRiskLevel } from '../models/flood-hazard';
import {
  NODE_FILTER_STATE,
  NODE_HEALTH_FLAG,
  NODE_QUALITY_FLAG,
} from '../../iot/protocol/node-protocol-v3';
import {
  multiplierForLevel,
  type EffectiveSensorState,
  type SensorDeploymentConfiguration,
  type SensorDeploymentWithState,
  type SensorObservationSource,
  type SensorReasonCode,
  type SensorStateRecord,
  type SensorStateWrite,
  type SensorTelemetryRecord,
} from './sensor-deployment.models';

const USABLE_FILTER_STATES = new Set<number>([
  NODE_FILTER_STATE.STABLE,
  NODE_FILTER_STATE.ACCEPTED,
  NODE_FILTER_STATE.TRANSIENT_REJECTED,
  NODE_FILTER_STATE.CHANGE_CONFIRMED,
]);

const UNUSABLE_HEALTH_FLAGS =
  NODE_HEALTH_FLAG.SONAR_INVALID |
  NODE_HEALTH_FLAG.FILTER_UNCERTAIN |
  NODE_HEALTH_FLAG.CALIBRATION_MISSING;

export interface ClassifySensorInput {
  readonly deployment: SensorDeploymentConfiguration;
  readonly telemetry: SensorTelemetryRecord | null;
  readonly previousState: SensorStateRecord | null;
  readonly now: Date;
}

export function deriveSensorState(input: ClassifySensorInput): SensorStateWrite {
  const { deployment, telemetry, previousState, now } = input;
  if (telemetry === null) {
    return unknownState(
      deployment,
      null,
      deployment.enabled ? 'UNKNOWN' : 'DISABLED',
      [deployment.enabled ? 'NO_TELEMETRY' : 'DEPLOYMENT_DISABLED'],
    );
  }

  const observation = selectObservationTime(telemetry);
  const validUntil = new Date(
    observation.observedAt.getTime() +
      deployment.staleAfterMinutes * 60_000,
  );
  const common = {
    nodeId: deployment.nodeId,
    telemetryId: telemetry.id,
    observedAt: observation.observedAt,
    observationSource: observation.source,
    validUntil,
    referenceDistanceMm: telemetry.referenceDistanceMm,
    acceptedDistanceMm: telemetry.acceptedDistanceMm,
    classificationConfigVersion: deployment.configVersion,
  } as const;

  if (!deployment.enabled) {
    return {
      ...common,
      waterHeightMm: null,
      classifiedLevel: 'UNKNOWN',
      classificationStatus: 'DISABLED',
      effectiveMultiplier: deployment.unknownMultiplier,
      reasonCodes: ['DEPLOYMENT_DISABLED'],
    };
  }

  const reasonCodes = telemetryReasonCodes(telemetry);
  if (reasonCodes.length > 0) {
    return {
      ...common,
      waterHeightMm: null,
      classifiedLevel: 'UNKNOWN',
      classificationStatus: 'UNKNOWN',
      effectiveMultiplier: deployment.unknownMultiplier,
      reasonCodes,
    };
  }

  const waterHeightMm = Math.max(
    0,
    (telemetry.referenceDistanceMm as number) -
      (telemetry.acceptedDistanceMm as number),
  );
  const canUseHysteresis =
    previousState !== null &&
    previousState.classificationStatus === 'VALID' &&
    previousState.classifiedLevel !== 'UNKNOWN' &&
    previousState.classificationConfigVersion === deployment.configVersion &&
    previousState.validUntil !== null &&
    now.getTime() <= previousState.validUntil.getTime();
  const classifiedLevel = canUseHysteresis
    ? classifyWithHysteresis(
        waterHeightMm,
        previousState.classifiedLevel,
        deployment,
      )
    : classifyDirect(waterHeightMm, deployment);

  return {
    ...common,
    waterHeightMm,
    classifiedLevel,
    classificationStatus: 'VALID',
    effectiveMultiplier: multiplierForLevel(deployment, classifiedLevel),
    reasonCodes: [],
  };
}

export function classifyDirect(
  waterHeightMm: number,
  configuration: Pick<
    SensorDeploymentConfiguration,
    'mediumThresholdMm' | 'highThresholdMm' | 'blockedThresholdMm'
  >,
): Exclude<FloodRiskLevel, 'UNKNOWN'> {
  if (waterHeightMm >= configuration.blockedThresholdMm) return 'BLOCKED';
  if (waterHeightMm >= configuration.highThresholdMm) return 'HIGH';
  if (waterHeightMm >= configuration.mediumThresholdMm) return 'MEDIUM';
  return 'LOW';
}

export function classifyWithHysteresis(
  waterHeightMm: number,
  previousLevel: Exclude<FloodRiskLevel, 'UNKNOWN'>,
  configuration: Pick<
    SensorDeploymentConfiguration,
    | 'mediumThresholdMm'
    | 'highThresholdMm'
    | 'blockedThresholdMm'
    | 'hysteresisMm'
  >,
): Exclude<FloodRiskLevel, 'UNKNOWN'> {
  const levels = ['LOW', 'MEDIUM', 'HIGH', 'BLOCKED'] as const;
  const upwardThresholds = [
    configuration.mediumThresholdMm,
    configuration.highThresholdMm,
    configuration.blockedThresholdMm,
  ];
  let levelIndex = levels.indexOf(previousLevel);

  while (
    levelIndex < levels.length - 1 &&
    waterHeightMm >= upwardThresholds[levelIndex]
  ) {
    levelIndex += 1;
  }
  while (
    levelIndex > 0 &&
    waterHeightMm <
      upwardThresholds[levelIndex - 1] - configuration.hysteresisMm
  ) {
    levelIndex -= 1;
  }
  return levels[levelIndex];
}

export function selectObservationTime(telemetry: SensorTelemetryRecord): {
  readonly observedAt: Date;
  readonly source: SensorObservationSource;
} {
  if (
    telemetry.gatewayTimeTrusted &&
    isValidDate(telemetry.gatewayReceivedAt)
  ) {
    return {
      observedAt: new Date(telemetry.gatewayReceivedAt.getTime()),
      source: 'GATEWAY',
    };
  }
  if (!isValidDate(telemetry.serverReceivedAt)) {
    throw new Error('Telemetry has no valid observation timestamp');
  }
  return {
    observedAt: new Date(telemetry.serverReceivedAt.getTime()),
    source: 'SERVER',
  };
}

export function evaluateEffectiveSensorState(
  record: SensorDeploymentWithState,
  now: Date,
): EffectiveSensorState {
  const { deployment } = record;
  const state = record.state ?? unknownState(deployment, null, 'UNKNOWN', [
    'NO_TELEMETRY',
  ]);
  const base = {
    deployment,
    telemetryId: state.telemetryId,
    observedAt: state.observedAt,
    observationSource: state.observationSource,
    validUntil: state.validUntil,
    referenceDistanceMm: state.referenceDistanceMm,
    acceptedDistanceMm: state.acceptedDistanceMm,
    waterHeightMm: state.waterHeightMm,
    classifiedLevel: state.classifiedLevel,
    classificationStatus: state.classificationStatus,
    classificationConfigVersion: state.classificationConfigVersion,
  } as const;

  if (!deployment.enabled) {
    return {
      ...base,
      effectiveLevel: 'UNKNOWN',
      effectiveMultiplier: deployment.unknownMultiplier,
      freshness: 'DISABLED',
      fresh: false,
      reasonCodes: ['DEPLOYMENT_DISABLED'],
    };
  }
  if (state.telemetryId === null || state.validUntil === null) {
    return {
      ...base,
      effectiveLevel: 'UNKNOWN',
      effectiveMultiplier: deployment.unknownMultiplier,
      freshness: 'NO_TELEMETRY',
      fresh: false,
      reasonCodes: ['NO_TELEMETRY'],
    };
  }
  if (now.getTime() > state.validUntil.getTime()) {
    return {
      ...base,
      effectiveLevel: 'UNKNOWN',
      effectiveMultiplier: deployment.unknownMultiplier,
      freshness: 'STALE',
      fresh: false,
      reasonCodes: uniqueReasonCodes([...state.reasonCodes, 'STALE']),
    };
  }
  return {
    ...base,
    effectiveLevel: state.classifiedLevel,
    effectiveMultiplier: state.effectiveMultiplier,
    freshness: 'FRESH',
    fresh: true,
    reasonCodes: state.reasonCodes,
  };
}

function telemetryReasonCodes(
  telemetry: SensorTelemetryRecord,
): SensorReasonCode[] {
  const reasons: SensorReasonCode[] = [];
  if (telemetry.referenceDistanceMm === null) {
    reasons.push('REFERENCE_DISTANCE_MISSING');
  }
  if (telemetry.acceptedDistanceMm === null) {
    reasons.push('ACCEPTED_DISTANCE_MISSING');
  }
  if (!USABLE_FILTER_STATES.has(telemetry.filterState)) {
    reasons.push('FILTER_INVALID');
  }
  if (
    (telemetry.healthFlags & UNUSABLE_HEALTH_FLAGS) !== 0 ||
    (telemetry.acceptedDistanceMm !== null &&
      (telemetry.qualityFlags & NODE_QUALITY_FLAG.ACCEPTED_DISTANCE_VALID) ===
        0)
  ) {
    reasons.push('SENSOR_UNHEALTHY');
  }
  return uniqueReasonCodes(reasons);
}

function unknownState(
  deployment: SensorDeploymentConfiguration,
  telemetryId: number | null,
  status: 'UNKNOWN' | 'DISABLED',
  reasonCodes: readonly SensorReasonCode[],
): SensorStateWrite {
  return {
    nodeId: deployment.nodeId,
    telemetryId,
    observedAt: null,
    observationSource: null,
    validUntil: null,
    referenceDistanceMm: null,
    acceptedDistanceMm: null,
    waterHeightMm: null,
    classifiedLevel: 'UNKNOWN',
    classificationStatus: status,
    effectiveMultiplier: deployment.unknownMultiplier,
    reasonCodes,
    classificationConfigVersion: deployment.configVersion,
  };
}

function uniqueReasonCodes(
  reasonCodes: readonly SensorReasonCode[],
): SensorReasonCode[] {
  return [...new Set(reasonCodes)];
}

function isValidDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
