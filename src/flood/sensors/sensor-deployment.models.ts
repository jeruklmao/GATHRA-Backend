import type {
  FloodRiskLevel,
  GeoJsonPolygon,
} from '../models/flood-hazard';

export const SENSOR_REASON_CODES = [
  'NO_TELEMETRY',
  'STALE',
  'REFERENCE_DISTANCE_MISSING',
  'ACCEPTED_DISTANCE_MISSING',
  'FILTER_INVALID',
  'SENSOR_UNHEALTHY',
  'DEPLOYMENT_DISABLED',
] as const;

export type SensorReasonCode = (typeof SENSOR_REASON_CODES)[number];
export type SensorClassificationStatus = 'VALID' | 'UNKNOWN' | 'DISABLED';
export type SensorObservationSource = 'GATEWAY' | 'SERVER';
export type SensorFreshness = 'FRESH' | 'STALE' | 'NO_TELEMETRY' | 'DISABLED';

export interface SensorDeploymentConfiguration {
  readonly nodeId: string;
  readonly enabled: boolean;
  readonly latitude: number;
  readonly longitude: number;
  readonly coveragePolygon: GeoJsonPolygon;
  readonly expectedPollIntervalMinutes: number;
  readonly staleAfterMinutes: number;
  readonly hysteresisMm: number;
  readonly mediumThresholdMm: number;
  readonly highThresholdMm: number;
  readonly blockedThresholdMm: number;
  readonly lowMultiplier: number;
  readonly mediumMultiplier: number;
  readonly highMultiplier: number;
  readonly blockedMultiplier: number;
  readonly unknownMultiplier: number;
  readonly configVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type SensorDeploymentWrite = Omit<
  SensorDeploymentConfiguration,
  'configVersion' | 'createdAt' | 'updatedAt'
>;

export interface SensorTelemetryRecord {
  readonly id: number;
  readonly nodeId: string;
  readonly persistentSessionId: number;
  readonly sequence: number;
  readonly gatewayReceivedAt: Date | null;
  readonly gatewayTimeTrusted: boolean;
  readonly serverReceivedAt: Date;
  readonly referenceDistanceMm: number | null;
  readonly acceptedDistanceMm: number | null;
  readonly filterState: number;
  readonly qualityFlags: number;
  readonly healthFlags: number;
}

export interface SensorStateRecord {
  readonly nodeId: string;
  readonly telemetryId: number | null;
  readonly observedAt: Date | null;
  readonly observationSource: SensorObservationSource | null;
  readonly validUntil: Date | null;
  readonly referenceDistanceMm: number | null;
  readonly acceptedDistanceMm: number | null;
  readonly waterHeightMm: number | null;
  readonly classifiedLevel: FloodRiskLevel;
  readonly classificationStatus: SensorClassificationStatus;
  readonly effectiveMultiplier: number;
  readonly reasonCodes: readonly SensorReasonCode[];
  readonly classificationConfigVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SensorStateWrite extends Omit<
  SensorStateRecord,
  'createdAt' | 'updatedAt'
> {}

export interface SensorDeploymentWithState {
  readonly deployment: SensorDeploymentConfiguration;
  readonly state: SensorStateRecord | null;
}

export interface EffectiveSensorState {
  readonly deployment: SensorDeploymentConfiguration;
  readonly telemetryId: number | null;
  readonly observedAt: Date | null;
  readonly observationSource: SensorObservationSource | null;
  readonly validUntil: Date | null;
  readonly referenceDistanceMm: number | null;
  readonly acceptedDistanceMm: number | null;
  readonly waterHeightMm: number | null;
  readonly classifiedLevel: FloodRiskLevel;
  readonly classificationStatus: SensorClassificationStatus;
  readonly effectiveLevel: FloodRiskLevel;
  readonly effectiveMultiplier: number;
  readonly freshness: SensorFreshness;
  readonly fresh: boolean;
  readonly reasonCodes: readonly SensorReasonCode[];
  readonly classificationConfigVersion: number;
}

export function multiplierForLevel(
  deployment: SensorDeploymentConfiguration,
  level: FloodRiskLevel,
): number {
  switch (level) {
    case 'LOW':
      return deployment.lowMultiplier;
    case 'MEDIUM':
      return deployment.mediumMultiplier;
    case 'HIGH':
      return deployment.highMultiplier;
    case 'BLOCKED':
      return deployment.blockedMultiplier;
    case 'UNKNOWN':
      return deployment.unknownMultiplier;
  }
}
