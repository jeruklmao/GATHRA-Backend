import { type DynamicModule, Module } from '@nestjs/common';
import { readConfiguration } from '../configuration';
import { DevFloodController } from './dev/dev-flood.controller';
import { FLOOD_HAZARD_PROVIDER } from './flood-hazard.provider';
import { RouteFloodEvaluator } from './geometry/route-flood-evaluator';
import { InMemoryFloodHazardProvider } from './providers/in-memory-flood-hazard.provider';

@Module({
  providers: [
    InMemoryFloodHazardProvider,
    {
      provide: FLOOD_HAZARD_PROVIDER,
      useExisting: InMemoryFloodHazardProvider,
    },
    RouteFloodEvaluator,
  ],
  exports: [
    FLOOD_HAZARD_PROVIDER,
    InMemoryFloodHazardProvider,
    RouteFloodEvaluator,
  ],
})
export class FloodModule {
  static register(): DynamicModule {
    const config = readConfiguration();
    const controllers = config.enableDevFloodEndpoints
      ? [DevFloodController]
      : [];

    return {
      module: FloodModule,
      controllers,
      providers: [
        InMemoryFloodHazardProvider,
        {
          provide: FLOOD_HAZARD_PROVIDER,
          useExisting: InMemoryFloodHazardProvider,
        },
        RouteFloodEvaluator,
      ],
      exports: [
        FLOOD_HAZARD_PROVIDER,
        InMemoryFloodHazardProvider,
        RouteFloodEvaluator,
      ],
    };
  }
}
