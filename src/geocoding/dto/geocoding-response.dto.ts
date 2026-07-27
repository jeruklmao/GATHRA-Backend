import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlaceCategory } from '../models/geocoding.models';

export class GeocodingPositionDto {
  @ApiProperty({ example: -6.1939 })
  latitude!: number;

  @ApiProperty({ example: 106.825 })
  longitude!: number;
}

export class PlaceSuggestionDto {
  @ApiProperty({ description: 'Opaque, signed place token.' })
  id!: string;

  @ApiProperty({ example: 'SMA Negeri 35 Jakarta' })
  primaryText!: string;

  @ApiPropertyOptional({
    example: 'Tanah Abang, Jakarta Pusat',
    nullable: true,
  })
  secondaryText!: string | null;

  @ApiPropertyOptional({ enum: PlaceCategory, nullable: true })
  category!: PlaceCategory | null;

  @ApiPropertyOptional({ type: GeocodingPositionDto, nullable: true })
  position!: GeocodingPositionDto | null;

  @ApiPropertyOptional({ example: 1_600, nullable: true })
  distanceMeters!: number | null;

  @ApiProperty({ example: true })
  insideSupportedRegion!: boolean;
}

export class PlaceSuggestionsResponseDto {
  @ApiProperty({ type: [PlaceSuggestionDto], maxItems: 8 })
  suggestions!: PlaceSuggestionDto[];

  @ApiProperty({ example: 'gathra-android-42' })
  requestId!: string;
}

export class PlaceDetailsDto {
  @ApiPropertyOptional({
    description: 'Opaque token when the result supports place lookup.',
    nullable: true,
  })
  id!: string | null;

  @ApiProperty({ example: 'SMA Negeri 35 Jakarta' })
  name!: string;

  @ApiPropertyOptional({
    example: 'Karet Tengsin, Tanah Abang, Jakarta Pusat',
    nullable: true,
  })
  formattedAddress!: string | null;

  @ApiProperty({ type: GeocodingPositionDto })
  position!: GeocodingPositionDto;

  @ApiPropertyOptional({ enum: PlaceCategory, nullable: true })
  category!: PlaceCategory | null;

  @ApiProperty({ example: true })
  insideSupportedRegion!: boolean;
}
