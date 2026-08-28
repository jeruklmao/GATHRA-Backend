import { Module } from '@nestjs/common';
import { readConfiguration } from '../configuration';
import { DatabaseModule } from '../database/database.module';
import { SensorDeploymentModule } from '../flood/sensors/sensor-deployment.module';
import {
  GatewayAuthGuard,
  IOT_GATEWAY_TOKEN_DIGEST,
} from './auth/gateway-auth.guard';
import { IotMonitoringController } from './controllers/iot-monitoring.controller';
import { TelemetryIngestionController } from './controllers/telemetry-ingestion.controller';
import { GatewayHeartbeatController } from './controllers/gateway-heartbeat.controller';
import { GatewayHeartbeatRepository } from './repositories/gateway-heartbeat.repository';
import { IotIngestionRepository } from './repositories/iot-ingestion.repository';
import { IotMonitoringRepository } from './repositories/iot-monitoring.repository';
import { IotMonitoringService } from './services/iot-monitoring.service';
import { TelemetryIngestionService } from './services/telemetry-ingestion.service';
import { GatewayHeartbeatService } from './services/gateway-heartbeat.service';
import { GatewayHeartbeatEventsService } from './services/gateway-heartbeat-events.service';

@Module({
  imports: [DatabaseModule, SensorDeploymentModule],
  controllers: [TelemetryIngestionController, GatewayHeartbeatController, IotMonitoringController],
  providers: [
    IotIngestionRepository,
    IotMonitoringRepository,
    GatewayHeartbeatRepository,
    TelemetryIngestionService,
    IotMonitoringService,
    GatewayHeartbeatService,
    GatewayHeartbeatEventsService,
    GatewayAuthGuard,
    {
      provide: IOT_GATEWAY_TOKEN_DIGEST,
      useFactory: (): Buffer | null => {
        const digest = readConfiguration().iotGatewayTokenSha256;
        return digest === undefined ? null : Buffer.from(digest, 'hex');
      },
    },
  ],
  exports: [IotMonitoringService, GatewayHeartbeatService, GatewayHeartbeatEventsService],
})
export class IotModule {}
