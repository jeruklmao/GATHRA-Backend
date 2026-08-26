import { ApiProperty } from '@nestjs/swagger';

export class FloodHazardPropertiesDto {
  @ApiProperty({
    enum: ['LOW', 'MEDIUM', 'HIGH', 'BLOCKED', 'UNKNOWN'],
    example: 'HIGH',
  })
  riskLevel!: string;

  @ApiProperty({ example: 0.95, nullable: true })
  confidence!: number | null;

  @ApiProperty({ example: 'Simulated HIGH flood hazard', nullable: true })
  description!: string | null;

  @ApiProperty({ example: '2026-07-28T06:20:00.000Z', nullable: true })
  observedAt!: string | null;

  @ApiProperty({ example: '2026-07-29T06:20:00.000Z', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ enum: ['SIMULATED', 'SENSOR'], example: 'SENSOR' })
  source!: string;

  @ApiProperty({ example: ['node_central_01'], type: [String] })
  sourceNodeIds!: string[];

  @ApiProperty({
    description:
      'Runtime routing multiplier. 1 means no penalty; 0 means hard exclusion.',
    example: 0.35,
    minimum: 0,
    maximum: 1,
  })
  routingMultiplier!: number;

  @ApiProperty({
    description: 'Bounded reason codes explaining UNKNOWN sensor state.',
    type: [String],
    example: ['STALE'],
  })
  reasonCodes!: string[];

  @ApiProperty({
    enum: ['FRESH', 'STALE', 'NO_TELEMETRY'],
    nullable: true,
    example: 'FRESH',
  })
  freshness!: string | null;
}

export class GeoJsonPolygonGeometryDto {
  @ApiProperty({ example: 'Polygon' })
  type!: 'Polygon';

  @ApiProperty({
    description: 'Array of LinearRing coordinate arrays in [longitude, latitude] order.',
    example: [
      [
        [106.817, -6.201],
        [106.821, -6.201],
        [106.821, -6.193],
        [106.817, -6.193],
        [106.817, -6.201],
      ],
    ],
  })
  coordinates!: readonly (readonly (readonly [number, number])[])[];
}

export class FloodHazardFeatureDto {
  @ApiProperty({ example: 'Feature' })
  type!: 'Feature';

  @ApiProperty({ example: 'preset_central_corridor_high' })
  id!: string;

  @ApiProperty({ type: FloodHazardPropertiesDto })
  properties!: FloodHazardPropertiesDto;

  @ApiProperty({ type: GeoJsonPolygonGeometryDto })
  geometry!: GeoJsonPolygonGeometryDto;
}

export class FloodHazardsResponseDto {
  @ApiProperty({ example: 'FeatureCollection' })
  type!: 'FeatureCollection';

  @ApiProperty({ example: 'snapshot_95f20c0a_v1_1' })
  snapshotId!: string;

  @ApiProperty({ example: '2026-07-28T06:20:00.000Z' })
  generatedAt!: string;

  @ApiProperty({ example: '2026-07-29T06:20:00.000Z', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ enum: ['SIMULATED', 'SENSOR'], example: 'SENSOR' })
  source!: string;

  @ApiProperty({ type: [FloodHazardFeatureDto] })
  features!: FloodHazardFeatureDto[];
}
