import {
  BadRequestException,
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Put,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { from, interval, Observable, startWith, switchMap } from 'rxjs';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { ApiException } from '../../common/api-error';
import { mapDeployment } from '../../flood/admin/sensor-deployment-admin.controller';
import { SensorDeploymentService } from '../../flood/sensors/sensor-deployment.service';
import { SensorDeploymentValidationError } from '../../flood/sensors/sensor-deployment.validator';
import { AdminCsrfGuard, AdminSessionGuard } from '../auth/admin-session.guard';
import { AdminHostMetricsService } from '../metrics/admin-host-metrics.service';
import type { DashboardRange } from '../metrics/admin-traffic.service';
import { AdminObserverService } from '../observer/admin-observer.service';
import { AdminDashboardService } from './admin-dashboard.service';

@Controller({ path: 'admin/dashboard', version: '1' })
@UseGuards(AdminSessionGuard)
@ApiTags('Admin dashboard')
@ApiCookieAuth('adminSession')
export class AdminDashboardController {
  constructor(
    private readonly dashboard: AdminDashboardService,
    private readonly deployments: SensorDeploymentService,
    private readonly observer: AdminObserverService,
    private readonly hostMetrics: AdminHostMetricsService,
  ) {}

  @Get('overview')
  overview() {
    return this.dashboard.overview();
  }

  @Get('nodes')
  nodes() {
    return this.dashboard.nodes();
  }

  @Get('nodes/:nodeId')
  node(@Param('nodeId') nodeId: string) {
    return this.dashboard.node(nodeId);
  }

  @Get('nodes/:nodeId/telemetry')
  history(
    @Param('nodeId') nodeId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.dashboard.history(nodeId, query);
  }

  @Get('nodes/:nodeId/charts')
  charts(@Param('nodeId') nodeId: string, @Query('range') range = '24h') {
    return this.dashboard.charts(nodeId, range);
  }

  @Get('gateways')
  gateways() {
    return this.dashboard.gateways();
  }

  @Get('sensor-deployments')
  async sensorDeployments() {
    return { deployments: (await this.deployments.listEffective()).map(mapDeployment) };
  }

  @Put('sensor-deployments/:nodeId')
  @UseGuards(AdminCsrfGuard)
  async updateDeployment(
    @Param('nodeId') nodeId: string,
    @Body() body: unknown,
  ) {
    try {
      return { deployment: mapDeployment(await this.deployments.upsert(nodeId, body)) };
    } catch (error) {
      if (error instanceof SensorDeploymentValidationError) {
        throw ApiException.validation([{ field: error.field, reason: error.message }]);
      }
      throw error;
    }
  }

  @Post('sensor-deployments/:nodeId/recompute')
  @UseGuards(AdminCsrfGuard)
  async recompute(@Param('nodeId') nodeId: string) {
    const previous = await this.deployments.getEffective(nodeId);
    const next = await this.deployments.recomputeNode(nodeId);
    if (next === null) throw new BadRequestException('Sensor deployment was not found');
    return {
      previous: previous === null ? null : summarizeState(previous),
      current: summarizeState(next),
    };
  }

  @Get('server')
  server() {
    return this.observer.snapshot();
  }

  @Get('server/metrics')
  serverMetrics(@Query('range') range = '24h') {
    return this.hostMetrics.history(range);
  }

  @Get('traffic')
  traffic(@Query('range') range = '24h') {
    return this.dashboard.trafficMetrics(validRange(range));
  }

  @Get('logs')
  logs(
    @Query('source') source = 'backend',
    @Query('lines') lines = '100',
    @Query('search') search?: string,
    @Query('severity') severity?: string,
  ) {
    const parsed = Number(lines);
    if (![100, 300, 500].includes(parsed)) {
      throw new BadRequestException('lines must be 100, 300, or 500');
    }
    return this.observer.logs({ source, lines: parsed, search, severity });
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    return interval(5_000).pipe(
      startWith(0),
      switchMap(() => from(this.dashboard.overview())),
      switchMap((data) => from([{ type: 'snapshot', data } satisfies MessageEvent])),
    );
  }
}

function summarizeState(state: Awaited<ReturnType<SensorDeploymentService['getEffective']>> & {}) {
  return {
    telemetryId: state.telemetryId,
    classifiedLevel: state.classifiedLevel,
    effectiveLevel: state.effectiveLevel,
    effectiveMultiplier: state.effectiveMultiplier,
    fresh: state.fresh,
    reasonCodes: state.reasonCodes,
    configVersion: state.deployment.configVersion,
  };
}

function validRange(value: string): DashboardRange {
  if (value === '1h' || value === '24h' || value === '7d' || value === '30d') return value;
  throw new BadRequestException('range must be 1h, 24h, 7d, or 30d');
}
