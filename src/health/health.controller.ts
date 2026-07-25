import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Res,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ROUTING_PROVIDER,
  type RoutingProvider,
} from '../routes/routing-provider';

class HealthChecksDto {
  @ApiProperty({ enum: ['up', 'down'] })
  routing!: 'up' | 'down';
}

class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  status!: 'ok' | 'unavailable';

  @ApiProperty({ example: 'gathra-routing-api' })
  service!: 'gathra-routing-api';

  @ApiProperty({ type: HealthChecksDto })
  checks!: HealthChecksDto;
}

@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    @Inject(ROUTING_PROVIDER)
    private readonly routingProvider: RoutingProvider,
  ) {}

  @Get()
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto })
  async health(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponseDto> {
    try {
      await this.routingProvider.health();
      return {
        status: 'ok',
        service: 'gathra-routing-api',
        checks: { routing: 'up' },
      };
    } catch {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      response.setHeader('Cache-Control', 'no-store');
      return {
        status: 'unavailable',
        service: 'gathra-routing-api',
        checks: { routing: 'down' },
      };
    }
  }
}
