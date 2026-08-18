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
import { DatabaseService } from '../database/database.service';
import {
  GEOCODING_PROVIDER,
  type GeocodingProvider,
} from '../geocoding/geocoding-provider';
import {
  ROUTING_PROVIDER,
  type RoutingProvider,
} from '../routes/routing-provider';

class HealthChecksDto {
  @ApiProperty({ enum: ['up', 'down'] })
  routing!: 'up' | 'down';

  @ApiProperty({ enum: ['up', 'down'] })
  geocoding!: 'up' | 'down';

  @ApiProperty({ enum: ['up', 'down'] })
  postgresql!: 'up' | 'down';
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
    @Inject(GEOCODING_PROVIDER)
    private readonly geocodingProvider: GeocodingProvider,
    private readonly database: DatabaseService,
  ) {}

  @Get()
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto })
  async health(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponseDto> {
    const [routing, geocoding, postgresql] = await Promise.allSettled([
      this.routingProvider.health(),
      this.geocodingProvider.health(),
      this.database.health(),
    ]);
    const checks: HealthChecksDto = {
      routing: routing.status === 'fulfilled' ? 'up' : 'down',
      geocoding: geocoding.status === 'fulfilled' ? 'up' : 'down',
      postgresql: postgresql.status === 'fulfilled' ? 'up' : 'down',
    };
    if (
      routing.status === 'fulfilled' &&
      geocoding.status === 'fulfilled' &&
      postgresql.status === 'fulfilled'
    ) {
      return {
        status: 'ok',
        service: 'gathra-routing-api',
        checks,
      };
    }
    response.status(HttpStatus.SERVICE_UNAVAILABLE);
    response.setHeader('Cache-Control', 'no-store');
    return {
      status: 'unavailable',
      service: 'gathra-routing-api',
      checks,
    };
  }
}
