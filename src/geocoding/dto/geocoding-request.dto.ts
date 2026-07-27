import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, IsOptional } from 'class-validator';

export enum GeocodingTargetFieldDto {
  ORIGIN = 'ORIGIN',
  DESTINATION = 'DESTINATION',
}

export class GeocodingSearchQueryDto {
  @ApiProperty({ example: 'SMA Negeri 35' })
  @Allow()
  q?: unknown;

  @ApiPropertyOptional({ example: '-6.1939' })
  @IsOptional()
  lat?: unknown;

  @ApiPropertyOptional({ example: '106.825' })
  @IsOptional()
  lon?: unknown;

  @ApiPropertyOptional({ example: '6', default: '6' })
  @IsOptional()
  limit?: unknown;

  @ApiPropertyOptional({ example: 'id', default: 'id' })
  @IsOptional()
  language?: unknown;

  @ApiPropertyOptional({ enum: GeocodingTargetFieldDto })
  @IsOptional()
  forField?: unknown;
}

export class PlaceLookupParamsDto {
  @ApiProperty({ description: 'Opaque token returned by a search endpoint.' })
  @Allow()
  id?: unknown;
}

export class ReverseGeocodingQueryDto {
  @ApiProperty({ example: '-6.1939' })
  @Allow()
  lat?: unknown;

  @ApiProperty({ example: '106.825' })
  @Allow()
  lon?: unknown;

  @ApiPropertyOptional({ example: 'id', default: 'id' })
  @IsOptional()
  language?: unknown;
}
