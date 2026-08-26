import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SensorDeploymentRepository } from './sensor-deployment.repository';
import {
  SENSOR_NOW_FN,
  SensorDeploymentService,
} from './sensor-deployment.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    SensorDeploymentRepository,
    SensorDeploymentService,
    {
      provide: SENSOR_NOW_FN,
      useValue: () => new Date(),
    },
  ],
  exports: [SensorDeploymentRepository, SensorDeploymentService, SENSOR_NOW_FN],
})
export class SensorDeploymentModule {}
