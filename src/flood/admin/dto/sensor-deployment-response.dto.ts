import { ApiProperty } from '@nestjs/swagger';
import { GeoJsonPolygonGeometryDto } from '../../dto/flood-hazards-response.dto';

export class SensorDeploymentStateDto {
  @ApiProperty({ example: 159, nullable: true })
  latestTelemetryId!: number | null;

  @ApiProperty({ description: 'Protocol 3 calibration reference, in millimetres.', example: 1725, nullable: true })
  referenceDistanceMm!: number | null;

  @ApiProperty({ description: 'Node-filtered accepted distance, in millimetres.', example: 1625, nullable: true })
  acceptedDistanceMm!: number | null;

  @ApiProperty({ description: 'max(0, reference - accepted), in millimetres.', example: 100, nullable: true })
  waterHeightMm!: number | null;

  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'BLOCKED', 'UNKNOWN'] })
  classifiedLevel!: string;

  @ApiProperty({ enum: ['VALID', 'UNKNOWN', 'DISABLED'] })
  classificationStatus!: string;

  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'BLOCKED', 'UNKNOWN'] })
  effectiveLevel!: string;

  @ApiProperty({ description: 'Current runtime multiplier from 0.0 through 1.0.', minimum: 0, maximum: 1 })
  effectiveMultiplier!: number;

  @ApiProperty({ description: 'True only while now <= validUntil.', example: false })
  fresh!: boolean;

  @ApiProperty({ enum: ['FRESH', 'STALE', 'NO_TELEMETRY', 'DISABLED'] })
  freshness!: string;

  @ApiProperty({ description: 'Selected observation time as UTC ISO-8601.', nullable: true })
  observedAt!: string | null;

  @ApiProperty({ enum: ['GATEWAY', 'SERVER'], nullable: true })
  observationSource!: string | null;

  @ApiProperty({ description: 'observedAt + staleAfterMinutes as UTC ISO-8601.', nullable: true })
  validUntil!: string | null;

  @ApiProperty({
    type: [String],
    enum: [
      'NO_TELEMETRY',
      'STALE',
      'REFERENCE_DISTANCE_MISSING',
      'ACCEPTED_DISTANCE_MISSING',
      'FILTER_INVALID',
      'SENSOR_UNHEALTHY',
      'DEPLOYMENT_DISABLED',
    ],
  })
  reasonCodes!: string[];

  @ApiProperty({ example: 1, minimum: 1 })
  classificationConfigVersion!: number;
}

export class SensorDeploymentViewDto {
  @ApiProperty({ example: 'GTH-10003BD4BCFC' })
  nodeId!: string;

  @ApiProperty({ example: true })
  enabled!: boolean;

  @ApiProperty({ example: -6.235149042111252 })
  latitude!: number;

  @ApiProperty({ example: 106.72040149114301 })
  longitude!: number;

  @ApiProperty({ type: GeoJsonPolygonGeometryDto })
  coveragePolygon!: GeoJsonPolygonGeometryDto;

  @ApiProperty({ description: 'Minutes.', example: 10 })
  expectedPollIntervalMinutes!: number;

  @ApiProperty({ description: 'Minutes.', example: 30 })
  staleAfterMinutes!: number;

  @ApiProperty({ description: 'Millimetres.', example: 10 })
  hysteresisMm!: number;

  @ApiProperty({ description: 'Millimetres.', example: 20 })
  mediumThresholdMm!: number;

  @ApiProperty({ description: 'Millimetres.', example: 300 })
  highThresholdMm!: number;

  @ApiProperty({ description: 'Millimetres.', example: 750 })
  blockedThresholdMm!: number;

  @ApiProperty({ minimum: 0, maximum: 1, example: 1 })
  lowMultiplier!: number;

  @ApiProperty({ minimum: 0, maximum: 1, example: 0.35 })
  mediumMultiplier!: number;

  @ApiProperty({ minimum: 0, maximum: 1, example: 0.05 })
  highMultiplier!: number;

  @ApiProperty({ minimum: 0, maximum: 1, example: 0 })
  blockedMultiplier!: number;

  @ApiProperty({ minimum: 0, maximum: 1, example: 1 })
  unknownMultiplier!: number;

  @ApiProperty({ example: 1, minimum: 1 })
  configVersion!: number;

  @ApiProperty({ description: 'UTC ISO-8601.' })
  createdAt!: string;

  @ApiProperty({ description: 'UTC ISO-8601.' })
  updatedAt!: string;

  @ApiProperty({ type: SensorDeploymentStateDto })
  state!: SensorDeploymentStateDto;
}

export class SensorDeploymentResponseDto {
  @ApiProperty({ type: SensorDeploymentViewDto })
  deployment!: SensorDeploymentViewDto;
}

export class SensorDeploymentListResponseDto {
  @ApiProperty({ type: [SensorDeploymentViewDto] })
  deployments!: SensorDeploymentViewDto[];
}
