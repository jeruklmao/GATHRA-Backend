import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiException } from '../../common/api-error';
import { requestIdFrom } from '../../common/request-context';
import { FloodGeometryValidationError } from '../geometry/flood-geometry.validator';
import { InMemoryFloodHazardProvider } from '../providers/in-memory-flood-hazard.provider';
import { FloodAdminAuthGuard } from './flood-admin-auth.guard';

@ApiExcludeController()
@UseGuards(FloodAdminAuthGuard)
@Controller({ path: 'admin/flood-hazards', version: '1' })
export class FloodAdminController {
  private readonly logger = new Logger(FloodAdminController.name);

  constructor(private readonly provider: InMemoryFloodHazardProvider) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  listHazards() {
    return { hazards: this.provider.listHazards() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  addHazard(@Body() body: unknown, @Req() request: Request) {
    try {
      const hazard = this.provider.addHazard(body);
      this.audit(request, 'add', {
        hazardId: hazard.id,
        level: hazard.level,
      });
      return { hazard };
    } catch (error) {
      if (error instanceof FloodGeometryValidationError) {
        throw ApiException.validation([
          { field: 'hazard', reason: error.message },
        ]);
      }
      throw error;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  deleteHazard(@Param('id') id: string, @Req() request: Request) {
    const removed = this.provider.removeHazard(id);
    if (!removed) {
      throw new NotFoundException(`Hazard with id '${id}' not found`);
    }
    this.audit(request, 'delete', { hazardId: id });
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  clearHazards(@Req() request: Request) {
    const removedCount = this.provider.listHazards().length;
    this.provider.clearHazards();
    this.audit(request, 'clear', { removedCount });
  }

  @Post('presets/central-corridor-high')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  activateCentralCorridorHigh(@Req() request: Request) {
    const snapshot = this.provider.activateCentralCorridorPreset('HIGH');
    this.audit(request, 'activate-preset', {
      level: 'HIGH',
      snapshotId: snapshot.snapshotId,
      activeHazardCount: snapshot.hazards.length,
    });
    return { snapshot };
  }

  @Post('presets/central-corridor-blocked')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  activateCentralCorridorBlocked(@Req() request: Request) {
    const snapshot = this.provider.activateCentralCorridorPreset('BLOCKED');
    this.audit(request, 'activate-preset', {
      level: 'BLOCKED',
      snapshotId: snapshot.snapshotId,
      activeHazardCount: snapshot.hazards.length,
    });
    return { snapshot };
  }

  private audit(
    request: Request,
    operation: string,
    result: Readonly<Record<string, unknown>>,
  ): void {
    this.logger.warn({
      event: 'flood_admin_mutation',
      requestId: requestIdFrom(request),
      operation,
      ...result,
    });
  }
}
