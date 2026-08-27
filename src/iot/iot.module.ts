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
import { IotIngestionRepository } from './repositories/iot-ingestion.repository';
import { IotMonitoringRepository } from './repositories/iot-monitoring.repository';
import { IotMonitoringService } from './services/iot-monitoring.service';
import { TelemetryIngestionService } from './services/telemetry-ingestion.service';

@Module({
  imports: [DatabaseModule, SensorDeploymentModule],
  controllers: [TelemetryIngestionController, IotMonitoringController],
  providers: [
    IotIngestionRepository,
    IotMonitoringRepository,
    TelemetryIngestionService,
    IotMonitoringService,
    GatewayAuthGuard,
    {
      provide: IOT_GATEWAY_TOKEN_DIGEST,
      useFactory: (): Buffer | null => {
        const digest = readConfiguration().iotGatewayTokenSha256;
        return digest === undefined ? null : Buffer.from(digest, 'hex');
      },
    },
  ],
  exports: [IotMonitoringService],
})
export class IotModule {}
