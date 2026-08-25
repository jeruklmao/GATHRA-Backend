import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsInt,
  IsNumber,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GatewayDescriptorDto {
  @ApiProperty({ example: 'GTH-GW-AABBCCDDEEFF', maxLength: 48 })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,48}$/)
  gatewayId!: string;

  @ApiProperty({ example: 'AA:BB:CC:DD:EE:FF' })
  @IsString()
  @Matches(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/)
  hardwareMac!: string;

  @ApiProperty({ example: '1.0.0', maxLength: 32 })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9._+-]+$/)
  firmwareVersion!: string;

  @ApiProperty({ example: 1234567890, maximum: 4294967295 })
  @IsInt()
  @Min(0)
  @Max(0xffff_ffff)
  bootSessionId!: number;
}

export class GatewayTelemetryReadingDto {
  @ApiProperty({
    example: '2026-08-18T05:00:00.123Z',
    nullable: true,
  })
  @ValidateIf((_object, value: unknown) => value !== null)
  @MaxLength(32)
  @Matches(/Z$/, { message: 'gatewayReceivedAt must be an explicit UTC timestamp' })
  @IsISO8601({ strict: true, strictSeparator: true })
  gatewayReceivedAt!: string | null;

  @ApiProperty()
  @IsBoolean()
  gatewayTimeTrusted!: boolean;

  @ApiProperty({ example: 123456 })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  gatewayUptimeMs!: number;

  @ApiProperty({
    example: 1234567890,
    maximum: 4294967295,
    description:
      'Boot identity captured with this reading; it may differ from gateway.bootSessionId for records recovered after reboot.',
  })
  @IsInt()
  @Min(0)
  @Max(0xffff_ffff)
  gatewayBootSessionId!: number;

  @ApiProperty({ example: -91.5 })
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-200)
  @Max(50)
  rssiDbm!: number;

  @ApiProperty({ example: 8.25 })
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-50)
  @Max(50)
  snrDb!: number;

  @ApiProperty({ example: -731 })
  @IsInt()
  @Min(-10_000_000)
  @Max(10_000_000)
  frequencyErrorHz!: number;

  @ApiProperty({ example: 56, minimum: 1, maximum: 96 })
  @IsInt()
  @Min(1)
  @Max(96)
  packetLength!: number;

  @ApiProperty({ description: 'Exact Protocol v2 TELEMETRY packet, canonical Base64' })
  @IsString()
  @MinLength(4)
  @MaxLength(128)
  rawPayloadBase64!: string;
}

export class IngestTelemetryBatchDto {
  @ApiProperty({ example: 1 })
  @Equals(1)
  schemaVersion!: 1;

  @ApiProperty({ type: GatewayDescriptorDto })
  @ValidateNested()
  @Type(() => GatewayDescriptorDto)
  gateway!: GatewayDescriptorDto;

  @ApiProperty({ type: [GatewayTelemetryReadingDto], maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => GatewayTelemetryReadingDto)
  readings!: GatewayTelemetryReadingDto[];
}
