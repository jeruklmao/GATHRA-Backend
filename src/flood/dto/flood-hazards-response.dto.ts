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

  @ApiProperty({ example: '2026-07-28T06:20:00.000Z' })
  observedAt!: string;

  @ApiProperty({ example: '2026-07-29T06:20:00.000Z', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ example: 'SIMULATED' })
  source!: string;

  @ApiProperty({ example: ['node_central_01'], type: [String] })
  sourceNodeIds!: string[];
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

  @ApiProperty({ example: 'snapshot_v1_1' })
  snapshotId!: string;

  @ApiProperty({ example: '2026-07-28T06:20:00.000Z' })
  generatedAt!: string;

  @ApiProperty({ example: '2026-07-29T06:20:00.000Z', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ example: 'SIMULATED' })
  source!: string;

  @ApiProperty({ type: [FloodHazardFeatureDto] })
  features!: FloodHazardFeatureDto[];
}
