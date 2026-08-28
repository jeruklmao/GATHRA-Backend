import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsIP,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const MAX_COUNTER = Number.MAX_SAFE_INTEGER;

export class HeartbeatGatewayDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,48}$/)
  gatewayId!: string;

  @IsString()
  @Matches(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/)
  mac!: string;

  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9._+-]+$/)
  firmwareVersion!: string;

  @Equals(3)
  protocolVersion!: 3;

  @IsString()
  @MaxLength(23)
  @Matches(/^[A-Za-z0-9._+-]+$/)
  buildFlavor!: string;
}

export class HeartbeatRuntimeDto {
  @Counter() uptimeSeconds!: number;

  @IsString()
  @MaxLength(31)
  @Matches(/^[A-Z0-9_+-]+$/)
  resetReason!: string;

  @Counter(0xffff_ffff) bootCount!: number;
  @Counter() freeHeapBytes!: number;
  @Counter() minFreeHeapBytes!: number;
  @Counter() largestFreeHeapBlockBytes!: number;
  @Counter() sketchSizeBytes!: number;
  @Counter() freeSketchSpaceBytes!: number;
  @Counter() flashSizeBytes!: number;
}

export class HeartbeatNetworkDto {
  @IsBoolean() wifiConnected!: boolean;

  @IsString()
  @MaxLength(32)
  ssid!: string;

  @NullableNumber(-127, 0) wifiRssiDbm!: number | null;

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(15)
  @IsIP('4')
  localIp!: string | null;

  @IsIn(['UNKNOWN', 'HEALTHY', 'DEGRADED', 'OFFLINE'])
  backendConnectivityState!: 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'OFFLINE';

  @NullableTimestamp() lastBackendSuccessAt!: string | null;
  @NullableTimestamp() lastBackendErrorAt!: string | null;
  @Counter() consecutiveBackendFailures!: number;
}

export class HeartbeatTimeDto {
  @IsBoolean() timeValid!: boolean;
  @NullableTimestamp() currentUtc!: string | null;
  @NullableTimestamp() lastNtpSyncAt!: string | null;
  @NullableCounter() ntpAgeSeconds!: number | null;
}

export class HeartbeatLoraDto {
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,24}$/)
  pairedNodeId!: string | null;

  @NullableTimestamp() lastLoRaRxAt!: string | null;
  @NullableNumber(-200, 50) latestRssiDbm!: number | null;
  @NullableNumber(-50, 50) latestSnrDb!: number | null;
  @NullableInteger(-10_000_000, 10_000_000) latestFrequencyErrorHz!: number | null;
  @Counter() receivedPacketCount!: number;
  @Counter() validTelemetryCount!: number;
  @Counter() invalidPacketCount!: number;
  @Counter() crcErrorCount!: number;
  @Counter() protocolRejectedPacketCount!: number;
  @Counter() unpairedRejectedPacketCount!: number;
}

export class HeartbeatAckDto {
  @Counter() ackCount!: number;
  @Counter() ackSuccessCount!: number;
  @Counter() ackFailureCount!: number;
  @Counter() latencySampleCount!: number;
  @NullableNumber(0, 60_000) latestRxToAckStartMs!: number | null;
  @NullableNumber(0, 60_000) latestRxToAckCompleteMs!: number | null;
  @NullableNumber(0, 60_000) latestAckTxDurationMs!: number | null;
  @NullableNumber(0, 60_000) minRxToAckStartMs!: number | null;
  @NullableNumber(0, 60_000) maxRxToAckStartMs!: number | null;
  @NullableNumber(0, 60_000) avgRxToAckStartMs!: number | null;
  @NullableNumber(0, 60_000) minRxToAckCompleteMs!: number | null;
  @NullableNumber(0, 60_000) maxRxToAckCompleteMs!: number | null;
  @NullableNumber(0, 60_000) avgRxToAckCompleteMs!: number | null;
  @NullableNumber(0, 60_000) minAckTxDurationMs!: number | null;
  @NullableNumber(0, 60_000) maxAckTxDurationMs!: number | null;
  @NullableNumber(0, 60_000) avgAckTxDurationMs!: number | null;
}

export class HeartbeatQueueDto {
  @Counter(4096) depth!: number;
  @Counter(4096) capacity!: number;
  @NullableCounter() oldestRecordAgeSeconds!: number | null;
  @Counter() telemetryUploadSuccessCount!: number;
  @Counter() telemetryUploadFailureCount!: number;
}

export class HeartbeatCommandsDto {
  @NullableInteger(0, 0xffff_ffff) pendingCommandId!: number | null;

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(39)
  @Matches(/^[A-Z0-9_]+$/)
  pendingCommandType!: string | null;

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsIn(['PENDING', 'SENT'])
  pendingCommandState!: 'PENDING' | 'SENT' | null;

  @NullableInteger(0, 0xffff_ffff) lastCommandId!: number | null;

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(31)
  @Matches(/^[A-Z0-9_]+$/)
  lastCommandResult!: string | null;

  @Counter() commandsSentCount!: number;
  @Counter() commandResultsReceivedCount!: number;
}

export class GatewayHeartbeatDto {
  @ApiProperty({ example: 1 })
  @Equals(1)
  schemaVersion!: 1;

  @IsInt()
  @Min(15)
  @Max(3600)
  @IsOptional()
  heartbeatIntervalSeconds = 60;

  @ValidateNested()
  @IsDefined()
  @Type(() => HeartbeatGatewayDto)
  gateway!: HeartbeatGatewayDto;

  @ValidateNested()
  @IsDefined()
  @Type(() => HeartbeatRuntimeDto)
  runtime!: HeartbeatRuntimeDto;

  @ValidateNested()
  @IsDefined()
  @Type(() => HeartbeatNetworkDto)
  network!: HeartbeatNetworkDto;

  @ValidateNested()
  @IsDefined()
  @Type(() => HeartbeatTimeDto)
  time!: HeartbeatTimeDto;

  @ValidateNested()
  @IsDefined()
  @Type(() => HeartbeatLoraDto)
  lora!: HeartbeatLoraDto;

  @ValidateNested()
  @IsDefined()
  @Type(() => HeartbeatAckDto)
  ack!: HeartbeatAckDto;

  @ValidateNested()
  @IsDefined()
  @Type(() => HeartbeatQueueDto)
  queue!: HeartbeatQueueDto;

  @ValidateNested()
  @IsDefined()
  @Type(() => HeartbeatCommandsDto)
  commands!: HeartbeatCommandsDto;
}

function Counter(maximum = MAX_COUNTER): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    IsInt()(target, propertyKey);
    Min(0)(target, propertyKey);
    Max(maximum)(target, propertyKey);
  };
}

function NullableCounter(maximum = MAX_COUNTER): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    ValidateIf((_object, value: unknown) => value !== null)(target, propertyKey);
    Counter(maximum)(target, propertyKey);
  };
}

function NullableInteger(minimum: number, maximum: number): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    ValidateIf((_object, value: unknown) => value !== null)(target, propertyKey);
    IsInt()(target, propertyKey);
    Min(minimum)(target, propertyKey);
    Max(maximum)(target, propertyKey);
  };
}

function NullableNumber(minimum: number, maximum: number): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    ValidateIf((_object, value: unknown) => value !== null)(target, propertyKey);
    IsNumber({ allowInfinity: false, allowNaN: false })(target, propertyKey);
    Min(minimum)(target, propertyKey);
    Max(maximum)(target, propertyKey);
  };
}

function NullableTimestamp(): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    ValidateIf((_object, value: unknown) => value !== null)(target, propertyKey);
    IsString()(target, propertyKey);
    MaxLength(32)(target, propertyKey);
    Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)(target, propertyKey);
  };
}
