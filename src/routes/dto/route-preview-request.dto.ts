import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export enum TravelModeDto {
  CAR = 'CAR',
  MOTORCYCLE = 'MOTORCYCLE',
}

export class CoordinateDto {
  @ApiProperty({ example: -6.2, minimum: -90, maximum: 90 })
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: 106.8167, minimum: -180, maximum: 180 })
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  longitude!: number;
}

export class RoutePreviewRequestDto {
  @ApiProperty({ type: CoordinateDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CoordinateDto)
  origin!: CoordinateDto;

  @ApiProperty({ type: CoordinateDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CoordinateDto)
  destination!: CoordinateDto;

  @ApiProperty({ enum: TravelModeDto, example: TravelModeDto.CAR })
  @IsEnum(TravelModeDto)
  travelMode!: TravelModeDto;

  @ApiProperty({
    description: 'Number of extra routes requested beyond the recommended route.',
    enum: [0, 1],
    example: 1,
  })
  @IsInt()
  @Min(0)
  @Max(1)
  alternatives!: number;
}
