import { ApiProperty } from '@nestjs/swagger';
import { TravelModeDto } from './route-preview-request.dto';
import {
  NavigationManoeuvreType,
  NavigationModifier,
} from '../routing-provider';

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

export class RouteManoeuvreDto {
  @ApiProperty({ enum: NavigationManoeuvreType })
  type!: NavigationManoeuvreType;

  @ApiProperty({ enum: NavigationModifier })
  modifier!: NavigationModifier;

  @ApiProperty({
    description:
      'Compass bearing immediately before the manoeuvre, in degrees clockwise from north.',
    example: 95,
    nullable: true,
    minimum: 0,
    maximum: 359,
  })
  bearingBefore!: number | null;

  @ApiProperty({
    description:
      'Compass bearing immediately after the manoeuvre, in degrees clockwise from north.',
    example: 180,
    nullable: true,
    minimum: 0,
    maximum: 359,
  })
  bearingAfter!: number | null;
}

export class RouteStepDto {
  @ApiProperty({ example: 1, minimum: 0 })
  index!: number;

  @ApiProperty({ example: 'Belok kanan ke Jalan B' })
  instruction!: string;

  @ApiProperty({
    description: 'Road name supplied by the routing data; may be empty.',
    example: 'Jalan B',
  })
  streetName!: string;

  @ApiProperty({ example: 510, minimum: 0 })
  distanceMeters!: number;

  @ApiProperty({ example: 80, minimum: 0 })
  durationSeconds!: number;

  @ApiProperty({ type: RouteManoeuvreDto })
  manoeuvre!: RouteManoeuvreDto;

  @ApiProperty({
    description:
      'Inclusive start position in the parent route LineString coordinates.',
    example: 14,
    minimum: 0,
  })
  geometryStartIndex!: number;

  @ApiProperty({
    description:
      'Inclusive end position in the parent route LineString coordinates.',
    example: 29,
    minimum: 0,
  })
  geometryEndIndex!: number;
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

  @ApiProperty({
    description:
      'Ordered, provider-independent navigation steps whose intervals reference this route geometry.',
    type: [RouteStepDto],
    minItems: 2,
  })
  steps!: RouteStepDto[];
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
