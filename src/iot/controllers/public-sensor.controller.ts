import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PublicSensorService } from '../services/public-sensor.service';

@ApiTags('Public sensors')
@Controller({ path: 'sensors', version: '1' })
export class PublicSensorController {
  constructor(private readonly sensors: PublicSensorService) {}

  @Get(':nodeId')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'nodeId', example: 'GTH-10003BD4BCFC' })
  @ApiOperation({
    summary: 'Get sanitized authoritative current sensor information',
    description:
      'Public read-only Android contract. Flood state is the same classified state used by public hazards and routing. Gateway status is Backend-derived; radio recency follows sensor freshness and never classifies RSSI/SNR quality.',
  })
  current(@Param('nodeId') nodeId: string) {
    return this.sensors.current(nodeId);
  }
}
