import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  NodeIdParamDto,
  NodeListQueryDto,
  TelemetryHistoryQueryDto,
} from '../dto/monitoring-query.dto';
import type { MonitoringNodeSummary } from '../models/monitoring.models';
import { IotMonitoringService } from '../services/iot-monitoring.service';

const TELEMETRY_EXAMPLE = {
  id: 12345,
  nodeId: 'GTH-AABBCCDDEEFF',
  bootSessionId: 100,
  sequence: 42,
  measurement: {
    medianEchoUs: 4321,
    rawDistanceMm: 742,
    acceptedDistanceMm: 1498,
    referenceDistanceMm: 1500,
    madMm: 3,
    temperatureC: 29.41,
    humidityPercent: 82.13,
    batteryMv: 4012,
    validSamples: 7,
    totalSamples: 7,
    filterState: { code: 4, name: 'TRANSIENT_REJECTED' },
    qualityFlags: 7,
    healthFlags: 128,
  },
  reception: {
    gatewayId: 'GTH-GW-112233445566',
    hardwareMac: '11:22:33:44:55:66',
    gatewayBootSessionId: 1234567890,
    gatewayReceivedAt: '2026-08-18T05:10:00.123Z',
    gatewayTimeTrusted: true,
    gatewayUptimeMs: 123456,
    serverReceivedAt: '2026-08-18T05:10:01.000Z',
    rssiDbm: -91.5,
    snrDb: 8.25,
    frequencyErrorHz: -731,
    packetLength: 78,
  },
} as const;

const NODE_SUMMARY_EXAMPLE = {
  nodeId: 'GTH-AABBCCDDEEFF',
  firstSeenAt: '2026-08-18T05:00:01.000Z',
  lastSeenAt: '2026-08-18T05:10:01.000Z',
  lastGateway: {
    gatewayId: 'GTH-GW-112233445566',
    hardwareMac: '11:22:33:44:55:66',
  },
  latestTelemetry: TELEMETRY_EXAMPLE,
} as const;

@ApiTags('IoT public monitoring (read-only)')
@Controller({ path: 'iot/nodes', version: '1' })
export class IotMonitoringController {
  constructor(private readonly monitoring: IotMonitoringService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List Nodes ordered by most recently seen' })
  @ApiOkResponse({
    description:
      'Public read-only Node summaries. lastSeenAt is provided without inventing ONLINE semantics.',
    schema: { example: [NODE_SUMMARY_EXAMPLE] },
  })
  list(@Query() query: NodeListQueryDto): Promise<MonitoringNodeSummary[]> {
    return this.monitoring.listNodes(query);
  }

  @Get(':nodeId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get Node metadata and its latest telemetry' })
  @ApiOkResponse({ schema: { example: NODE_SUMMARY_EXAMPLE } })
  get(@Param() params: NodeIdParamDto): Promise<MonitoringNodeSummary> {
    return this.monitoring.getNode(params.nodeId);
  }

  @Get(':nodeId/telemetry')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Get bounded newest-first Node telemetry history',
    description:
      'Pagination and date filtering use the always-trusted serverReceivedAt timeline. includeRaw=true is intended only for debugging.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        nodeId: 'GTH-AABBCCDDEEFF',
        items: [TELEMETRY_EXAMPLE],
        nextBeforeId: 12146,
      },
    },
  })
  history(
    @Param() params: NodeIdParamDto,
    @Query() query: TelemetryHistoryQueryDto,
  ): ReturnType<IotMonitoringService['history']> {
    return this.monitoring.history(params.nodeId, query);
  }
}
