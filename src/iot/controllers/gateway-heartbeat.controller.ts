import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GatewayAuthGuard } from '../auth/gateway-auth.guard';
import { GatewayHeartbeatDto } from '../dto/gateway-heartbeat.dto';
import { GatewayHeartbeatService } from '../services/gateway-heartbeat.service';

@ApiTags('IoT Gateway ingestion')
@ApiBearerAuth('gatewayBearer')
@UseGuards(GatewayAuthGuard)
@Controller({ path: 'iot/gateway', version: '1' })
export class GatewayHeartbeatController {
  constructor(private readonly heartbeat: GatewayHeartbeatService) {}

  @Post('heartbeat')
  @HttpCode(202)
  @ApiOperation({ summary: 'Accept a validated Gateway Firmware 2.2 operational heartbeat' })
  @ApiBody({ type: GatewayHeartbeatDto })
  @ApiAcceptedResponse({ description: 'Heartbeat state and compact historical metrics were persisted.' })
  accept(@Body() body: GatewayHeartbeatDto) {
    return this.heartbeat.accept(body);
  }
}
