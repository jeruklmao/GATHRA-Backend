import {
  FloodGeometryValidationError,
  validateGeoJsonPolygon,
} from '../geometry/flood-geometry.validator';
import { isPointInsidePolygon } from '../geometry/route-flood-evaluator';
import type { SensorDeploymentWrite } from './sensor-deployment.models';

const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;

export class SensorDeploymentValidationError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'SensorDeploymentValidationError';
  }
}

export function validateSensorDeployment(
  input: unknown,
  maxPolygonVertices: number,
): SensorDeploymentWrite {
  if (!isRecord(input)) {
    throw new SensorDeploymentValidationError(
      'deployment',
      'Deployment must be an object',
    );
  }
  const nodeId = input.nodeId;
  if (typeof nodeId !== 'string' || !NODE_ID_PATTERN.test(nodeId)) {
    throw new SensorDeploymentValidationError(
      'nodeId',
      'nodeId must contain 1 to 24 Protocol-compatible characters',
    );
  }
  if (typeof input.enabled !== 'boolean') {
    throw new SensorDeploymentValidationError(
      'enabled',
      'enabled must be a boolean',
    );
  }
  const latitude = finiteNumber(input.latitude, 'latitude');
  const longitude = finiteNumber(input.longitude, 'longitude');
  if (latitude < -90 || latitude > 90) {
    throw new SensorDeploymentValidationError(
      'latitude',
      'latitude must be between -90 and 90',
    );
  }
  if (longitude < -180 || longitude > 180) {
    throw new SensorDeploymentValidationError(
      'longitude',
      'longitude must be between -180 and 180',
    );
  }

  let coveragePolygon;
  try {
    coveragePolygon = validateGeoJsonPolygon(
      input.coveragePolygon,
      maxPolygonVertices,
    );
  } catch (error) {
    if (error instanceof FloodGeometryValidationError) {
      throw new SensorDeploymentValidationError(
        'coveragePolygon',
        error.message,
      );
    }
    throw error;
  }
  if (
    !isPointInsidePolygon(
      [longitude, latitude],
      coveragePolygon.coordinates,
    )
  ) {
    throw new SensorDeploymentValidationError(
      'coveragePolygon',
      'Sensor location must lie inside its coverage polygon',
    );
  }

  const expectedPollIntervalMinutes = nonNegativeSafeInteger(
    input.expectedPollIntervalMinutes,
    'expectedPollIntervalMinutes',
  );
  if (expectedPollIntervalMinutes < 1) {
    throw new SensorDeploymentValidationError(
      'expectedPollIntervalMinutes',
      'expectedPollIntervalMinutes must be at least 1 minute',
    );
  }
  const staleAfterMinutes = nonNegativeSafeInteger(
    input.staleAfterMinutes,
    'staleAfterMinutes',
  );
  if (staleAfterMinutes < expectedPollIntervalMinutes) {
    throw new SensorDeploymentValidationError(
      'staleAfterMinutes',
      'staleAfterMinutes must be at least expectedPollIntervalMinutes',
    );
  }
  const hysteresisMm = nonNegativeSafeInteger(
    input.hysteresisMm,
    'hysteresisMm',
  );
  const mediumThresholdMm = nonNegativeSafeInteger(
    input.mediumThresholdMm,
    'mediumThresholdMm',
  );
  const highThresholdMm = nonNegativeSafeInteger(
    input.highThresholdMm,
    'highThresholdMm',
  );
  const blockedThresholdMm = nonNegativeSafeInteger(
    input.blockedThresholdMm,
    'blockedThresholdMm',
  );
  if (
    mediumThresholdMm >= highThresholdMm ||
    highThresholdMm >= blockedThresholdMm
  ) {
    throw new SensorDeploymentValidationError(
      'thresholds',
      'Thresholds must satisfy 0 <= mediumThresholdMm < highThresholdMm < blockedThresholdMm',
    );
  }
  if (
    hysteresisMm > mediumThresholdMm ||
    hysteresisMm > highThresholdMm - mediumThresholdMm ||
    hysteresisMm > blockedThresholdMm - highThresholdMm
  ) {
    throw new SensorDeploymentValidationError(
      'hysteresisMm',
      'hysteresisMm must not reverse or overlap any downward release boundary',
    );
  }

  return {
    nodeId,
    enabled: input.enabled,
    latitude,
    longitude,
    coveragePolygon,
    referenceDistanceOverrideMm: nullableReferenceDistance(
      input.referenceDistanceOverrideMm,
    ),
    expectedPollIntervalMinutes,
    staleAfterMinutes,
    hysteresisMm,
    mediumThresholdMm,
    highThresholdMm,
    blockedThresholdMm,
    lowMultiplier: multiplier(input.lowMultiplier, 'lowMultiplier'),
    mediumMultiplier: multiplier(
      input.mediumMultiplier,
      'mediumMultiplier',
    ),
    highMultiplier: multiplier(input.highMultiplier, 'highMultiplier'),
    blockedMultiplier: multiplier(
      input.blockedMultiplier,
      'blockedMultiplier',
    ),
    unknownMultiplier: multiplier(
      input.unknownMultiplier,
      'unknownMultiplier',
    ),
  };
}

function nullableReferenceDistance(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 4_294_967_295
  ) {
    throw new SensorDeploymentValidationError(
      'referenceDistanceOverrideMm',
      'referenceDistanceOverrideMm must be null or an integer from 1 through 4294967295',
    );
  }
  return value as number;
}

function multiplier(value: unknown, field: string): number {
  const parsed = finiteNumber(value, field);
  if (parsed < 0 || parsed > 1) {
    throw new SensorDeploymentValidationError(
      field,
      `${field} must be between 0.0 and 1.0`,
    );
  }
  return parsed;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SensorDeploymentValidationError(
      field,
      `${field} must be a finite number`,
    );
  }
  return value;
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new SensorDeploymentValidationError(
      field,
      `${field} must be a non-negative safe integer`,
    );
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
