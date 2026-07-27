import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiException } from '../../common/api-error';

import { FloodGeometryValidationError } from '../geometry/flood-geometry.validator';
import { InMemoryFloodHazardProvider } from '../providers/in-memory-flood-hazard.provider';

@ApiTags('dev-flood-simulation')
@Controller({ path: 'dev/flood-hazards', version: '1' })
export class DevFloodController {
  constructor(private readonly provider: InMemoryFloodHazardProvider) {}

  @Get()
  @ApiOperation({ summary: 'List all active simulated flood hazards (Development Only)' })
  listHazards() {
    return {
      hazards: this.provider.listHazards(),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a simulated flood hazard (Development Only)' })
  addHazard(@Body() body: unknown) {
    try {
      const hazard = this.provider.addHazard(body);
      return { hazard };
    } catch (error) {
      if (error instanceof FloodGeometryValidationError) {
        throw ApiException.validation([
          {
            field: 'hazard',
            reason: error.message,
          },
        ]);
      }
      throw error;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a simulated flood hazard by ID (Development Only)' })
  deleteHazard(@Param('id') id: string) {
    const removed = this.provider.removeHazard(id);
    if (!removed) {
      throw new NotFoundException(`Hazard with id '${id}' not found`);
    }
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear all simulated flood hazards (Development Only)' })
  clearHazards() {
    this.provider.clearHazards();
  }

  @Post('presets/central-corridor-high')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate HIGH flood hazard preset on central corridor (Development Only)' })
  activateCentralCorridorHigh() {
    const snapshot = this.provider.activateCentralCorridorPreset('HIGH');
    return { snapshot };
  }

  @Post('presets/central-corridor-blocked')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate BLOCKED flood hazard preset on central corridor (Development Only)' })
  activateCentralCorridorBlocked() {
    const snapshot = this.provider.activateCentralCorridorPreset('BLOCKED');
    return { snapshot };
  }
}
