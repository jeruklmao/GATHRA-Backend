import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  Max,
  Min,
} from 'class-validator';
import type { GeoJsonPolygon } from '../../models/flood-hazard';

export class UpsertSensorDeploymentDto {
  @ApiProperty({
    description: 'Whether this deployment contributes a public hazard polygon.',
    example: true,
  })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({
    description: 'Physical sensor latitude in decimal degrees.',
    example: -6.235149042111252,
    minimum: -90,
    maximum: 90,
  })
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({
    description: 'Physical sensor longitude in decimal degrees.',
    example: 106.72040149114301,
    minimum: -180,
    maximum: 180,
  })
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiProperty({
    description:
      'Validated GeoJSON Polygon. Every position is [longitude, latitude], every ring must be closed and non-self-intersecting, and the sensor point must lie inside.',
    example: {
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
  })
  @IsObject()
  coveragePolygon!: GeoJsonPolygon;

  @ApiProperty({
    description: 'Expected normal Node polling interval, in minutes (>= 1).',
    example: 10,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedPollIntervalMinutes!: number;

  @ApiProperty({
    description:
      'Freshness lifetime in minutes. Must be at least expectedPollIntervalMinutes. A reading is fresh through the exact validUntil instant and stale only when now > validUntil.',
    example: 30,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  staleAfterMinutes!: number;

  @ApiProperty({
    description:
      'Classification hysteresis in millimetres. Upward thresholds are unchanged; each downward release is strict (< threshold - hysteresis).',
    example: 10,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  hysteresisMm!: number;

  @ApiProperty({
    description:
      'Water-height threshold in millimetres for LOW -> MEDIUM. Thresholds must satisfy 0 <= medium < high < blocked.',
    example: 20,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  mediumThresholdMm!: number;

  @ApiProperty({
    description: 'Water-height threshold in millimetres for MEDIUM -> HIGH.',
    example: 300,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  highThresholdMm!: number;

  @ApiProperty({
    description: 'Water-height threshold in millimetres for HIGH -> BLOCKED.',
    example: 750,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  blockedThresholdMm!: number;

  @ApiProperty({
    description: 'GraphHopper priority multiplier for LOW (0.0 to 1.0).',
    example: 1,
    minimum: 0,
    maximum: 1,
  })
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1)
  lowMultiplier!: number;

  @ApiProperty({
    description: 'GraphHopper priority multiplier for MEDIUM (0.0 to 1.0).',
    example: 0.35,
    minimum: 0,
    maximum: 1,
  })
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1)
  mediumMultiplier!: number;

  @ApiProperty({
    description: 'GraphHopper priority multiplier for HIGH (0.0 to 1.0).',
    example: 0.05,
    minimum: 0,
    maximum: 1,
  })
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1)
  highMultiplier!: number;

  @ApiProperty({
    description:
      'GraphHopper priority multiplier for BLOCKED (0.0 to 1.0). Any effective multiplier of exactly 0 is a hard exclusion, regardless of level name.',
    example: 0,
    minimum: 0,
    maximum: 1,
  })
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1)
  blockedMultiplier!: number;

  @ApiProperty({
    description:
      'GraphHopper priority multiplier for UNKNOWN (0.0 to 1.0). UNKNOWN remains visible even when the owner policy assigns no penalty.',
    example: 1,
    minimum: 0,
    maximum: 1,
  })
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1)
  unknownMultiplier!: number;
}
