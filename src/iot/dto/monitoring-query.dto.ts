import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class NodeIdParamDto {
  @Matches(/^[A-Za-z0-9_-]{1,24}$/)
  nodeId!: string;
}

export class NodeListQueryDto {
  @ApiPropertyOptional({ default: 200, minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class TelemetryHistoryQueryDto extends NodeListQueryDto {
  @ApiPropertyOptional({
    description:
      'Opaque newest-first pagination cursor: pass the prior response nextBeforeId unchanged',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  beforeId?: number;

  @ApiPropertyOptional({
    description: 'Inclusive serverReceivedAt lower bound',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  from?: string;

  @ApiPropertyOptional({
    description: 'Inclusive serverReceivedAt upper bound',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  to?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Include rawPayloadBase64 for packet debugging',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  includeRaw?: boolean;
}
