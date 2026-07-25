import { ApiProperty } from '@nestjs/swagger';
import { TravelModeDto } from './route-preview-request.dto';

export class GeoJsonLineStringDto {
  @ApiProperty({ enum: ['LineString'], example: 'LineString' })
  type!: 'LineString';

  @ApiProperty({
    description: 'GeoJSON positions in [longitude, latitude] order.',
    example: [
      [106.8167, -6.2],
      [106.822, -6.195],
    ],
    type: 'array',
    items: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: { type: 'number' },
    },
  })
  coordinates!: [number, number][];
}

export class RouteSummaryDto {
  @ApiProperty({ example: 4_128, minimum: 1 })
  distanceMeters!: number;

  @ApiProperty({ example: 676, minimum: 1 })
  durationSeconds!: number;
}

export class RouteDto {
  @ApiProperty({
    description: 'Opaque, deterministic fingerprint of this route.',
    example: 'route_1b8b94a5f32e8c7d',
  })
  id!: string;

  @ApiProperty({ example: true })
  isRecommended!: boolean;

  @ApiProperty({ type: GeoJsonLineStringDto })
  geometry!: GeoJsonLineStringDto;

  @ApiProperty({ type: RouteSummaryDto })
  summary!: RouteSummaryDto;
}

export class RouteMetadataDto {
  @ApiProperty({ enum: TravelModeDto })
  travelMode!: TravelModeDto;

  @ApiProperty({ enum: [0, 1], example: 1 })
  requestedAlternatives!: number;

  @ApiProperty({ enum: [0, 1], example: 1 })
  returnedAlternatives!: number;
}

export class RoutePreviewResponseDto {
  @ApiProperty({
    description:
      'Generated UUID or a validated client-supplied X-Request-Id value.',
    example: 'gathra-android-42',
  })
  requestId!: string;

  @ApiProperty({ type: [RouteDto], minItems: 1, maxItems: 2 })
  routes!: RouteDto[];

  @ApiProperty({ type: RouteMetadataDto })
  metadata!: RouteMetadataDto;
}
