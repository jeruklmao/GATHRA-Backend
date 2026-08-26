import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiException } from '../../common/api-error';
import { requestIdFrom } from '../../common/request-context';
import type { EffectiveSensorState } from '../sensors/sensor-deployment.models';
import { SensorDeploymentService } from '../sensors/sensor-deployment.service';
import { SensorDeploymentValidationError } from '../sensors/sensor-deployment.validator';
import { FloodAdminAuthGuard } from './flood-admin-auth.guard';
import { UpsertSensorDeploymentDto } from './dto/upsert-sensor-deployment.dto';
import {
  SensorDeploymentListResponseDto,
  SensorDeploymentResponseDto,
} from './dto/sensor-deployment-response.dto';

@ApiTags('Flood sensor administration')
@ApiBearerAuth('floodAdminBearer')
@UseGuards(FloodAdminAuthGuard)
@Controller({ path: 'admin/iot/sensor-deployments', version: '1' })
export class SensorDeploymentAdminController {
  private readonly logger = new Logger(SensorDeploymentAdminController.name);

  constructor(private readonly deployments: SensorDeploymentService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List configured flood sensor deployments and effective state',
    description:
      'Returns runtime configuration plus latest interpreted telemetry diagnostics. Timestamps are UTC ISO-8601. Effective freshness is evaluated against the current time.',
  })
  @ApiOkResponse({
    type: SensorDeploymentListResponseDto,
    description: 'Sensor deployments sorted by Node ID. Credentials are never returned.',
  })
  async listDeployments() {
    return {
      deployments: (await this.deployments.listEffective()).map(mapDeployment),
    };
  }

  @Get(':nodeId')
  @Header('Cache-Control', 'no-store')
  @ApiParam({
    name: 'nodeId',
    description: 'Protocol 3 Node ID (1 to 24 letters, digits, underscore, or hyphen).',
    example: 'GTH-10003BD4BCFC',
  })
  @ApiOperation({
    summary: 'Get one flood sensor deployment and effective state',
  })
  @ApiOkResponse({ type: SensorDeploymentResponseDto })
  async getDeployment(@Param('nodeId') nodeId: string) {
    validateNodeId(nodeId);
    const state = await this.deployments.getEffective(nodeId);
    if (state === null) {
      throw new NotFoundException(`Sensor deployment '${nodeId}' was not found`);
    }
    return { deployment: mapDeployment(state) };
  }

  @Put(':nodeId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiParam({
    name: 'nodeId',
    description: 'Protocol 3 Node ID. A Node may be configured before first telemetry.',
    example: 'GTH-10003BD4BCFC',
  })
  @ApiBody({ type: UpsertSensorDeploymentDto })
  @ApiOperation({
    summary: 'Create or replace a flood sensor deployment atomically',
    description:
      'Validates the complete configuration, increments configVersion only for material changes, and recomputes from the latest stored Protocol 3 telemetry in the same transaction. Water height uses max(0, referenceDistanceMm - acceptedDistanceMm); rawDistanceMm is never the primary flood height.',
  })
  @ApiOkResponse({
    type: SensorDeploymentResponseDto,
    description:
      'Persisted deployment and immediately recomputed current state. The token is never included.',
  })
  async upsertDeployment(
    @Param('nodeId') nodeId: string,
    @Body() body: UpsertSensorDeploymentDto,
    @Req() request: Request,
  ) {
    validateNodeId(nodeId);
    try {
      const state = await this.deployments.upsert(nodeId, body);
      this.logger.warn({
        event: 'sensor_deployment_upsert',
        requestId: requestIdFrom(request),
        nodeId,
        configVersion: state.deployment.configVersion,
        enabled: state.deployment.enabled,
      });
      return { deployment: mapDeployment(state) };
    } catch (error) {
      if (error instanceof SensorDeploymentValidationError) {
        throw ApiException.validation([
          { field: error.field, reason: error.message },
        ]);
      }
      throw error;
    }
  }
}

function mapDeployment(state: EffectiveSensorState) {
  const deployment = state.deployment;
  return {
    nodeId: deployment.nodeId,
    enabled: deployment.enabled,
    latitude: deployment.latitude,
    longitude: deployment.longitude,
    coveragePolygon: deployment.coveragePolygon,
    expectedPollIntervalMinutes: deployment.expectedPollIntervalMinutes,
    staleAfterMinutes: deployment.staleAfterMinutes,
    hysteresisMm: deployment.hysteresisMm,
    mediumThresholdMm: deployment.mediumThresholdMm,
    highThresholdMm: deployment.highThresholdMm,
    blockedThresholdMm: deployment.blockedThresholdMm,
    lowMultiplier: deployment.lowMultiplier,
    mediumMultiplier: deployment.mediumMultiplier,
    highMultiplier: deployment.highMultiplier,
    blockedMultiplier: deployment.blockedMultiplier,
    unknownMultiplier: deployment.unknownMultiplier,
    configVersion: deployment.configVersion,
    createdAt: deployment.createdAt.toISOString(),
    updatedAt: deployment.updatedAt.toISOString(),
    state: {
      latestTelemetryId: state.telemetryId,
      referenceDistanceMm: state.referenceDistanceMm,
      acceptedDistanceMm: state.acceptedDistanceMm,
      waterHeightMm: state.waterHeightMm,
      classifiedLevel: state.classifiedLevel,
      classificationStatus: state.classificationStatus,
      effectiveLevel: state.effectiveLevel,
      effectiveMultiplier: state.effectiveMultiplier,
      fresh: state.fresh,
      freshness: state.freshness,
      observedAt: state.observedAt?.toISOString() ?? null,
      observationSource: state.observationSource,
      validUntil: state.validUntil?.toISOString() ?? null,
      reasonCodes: [...state.reasonCodes],
      classificationConfigVersion: state.classificationConfigVersion,
    },
  };
}

function validateNodeId(nodeId: string): void {
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(nodeId)) {
    throw ApiException.validation([
      {
        field: 'nodeId',
        reason:
          'nodeId must contain 1 to 24 letters, digits, underscore, or hyphen',
      },
    ]);
  }
}
