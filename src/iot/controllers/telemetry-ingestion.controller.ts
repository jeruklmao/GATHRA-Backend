import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DatabaseService } from '../../database/database.service';
import { readConfiguration } from '../../configuration';
import { GatewayAuthGuard } from '../auth/gateway-auth.guard';
import { IngestTelemetryBatchDto } from '../dto/ingest-telemetry.dto';
import type { IngestionBatchResponse } from '../models/ingestion.models';
import { TelemetryIngestionService } from '../services/telemetry-ingestion.service';

@ApiTags('IoT Gateway ingestion')
@ApiBearerAuth('gatewayBearer')
@UseGuards(GatewayAuthGuard)
@Controller({ path: 'iot', version: '1' })
export class TelemetryIngestionController {
  constructor(
    private readonly ingestion: TelemetryIngestionService,
    private readonly database: DatabaseService,
  ) {}

  @Post('telemetry/batch')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Persist a Gateway batch of exact Protocol v2 LoRa packets',
    description:
      'Gateway-authenticated ingestion. Each packet is independently decoded and returns INSERTED, DUPLICATE, or REJECTED_INVALID.',
  })
  @ApiBody({ type: IngestTelemetryBatchDto })
  @ApiOkResponse({
    schema: {
      example: {
        receivedAt: '2026-08-18T05:01:00.000Z',
        results: [
          {
            index: 0,
            nodeId: 'GTH-AABBCCDDEEFF',
            bootSessionId: 1234,
            sequence: 99,
            status: 'INSERTED',
          },
        ],
      },
    },
  })
  ingest(
    @Body() request: IngestTelemetryBatchDto,
  ): Promise<IngestionBatchResponse> {
    return this.ingestion.ingest(request);
  }

  @Get('gateway/ping')
  @ApiOperation({
    summary: 'Verify Gateway authentication, API compatibility, and database',
  })
  async ping(): Promise<{
    status: 'ok';
    ingestionSchemaVersion: 1;
    nodeProtocolVersion: 2;
    maximumBatchSize: number;
  }> {
    await this.database.health();
    return {
      status: 'ok',
      ingestionSchemaVersion: 1,
      nodeProtocolVersion: 2,
      maximumBatchSize: readConfiguration().iotMaxBatchSize,
    };
  }
}
