import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class FloodHazardsQueryDto {
  @ApiPropertyOptional({
    description: 'Minimum latitude (-90 to 90) for bounding box filter.',
    example: -6.25,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  minLat?: number;

  @ApiPropertyOptional({
    description: 'Minimum longitude (-180 to 180) for bounding box filter.',
    example: 106.75,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  minLon?: number;

  @ApiPropertyOptional({
    description: 'Maximum latitude (-90 to 90) for bounding box filter.',
    example: -6.1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  maxLat?: number;

  @ApiPropertyOptional({
    description: 'Maximum longitude (-180 to 180) for bounding box filter.',
    example: 106.9,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  maxLon?: number;
}
