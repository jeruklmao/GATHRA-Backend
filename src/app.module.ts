import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { FloodModule } from './flood/flood.module';
import { GeocodingModule } from './geocoding/geocoding.module';
import { HealthController } from './health/health.controller';
import { GraphHopperClient } from './routes/graphhopper.client';
import { RoutesController } from './routes/routes.controller';
import { RoutesService } from './routes/routes.service';
import { ROUTING_PROVIDER } from './routes/routing-provider';

@Module({
  imports: [GeocodingModule, FloodModule.register()],
  controllers: [RoutesController, HealthController],
  providers: [
    RoutesService,
    GraphHopperClient,
    {
      provide: ROUTING_PROVIDER,
      useExisting: GraphHopperClient,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
