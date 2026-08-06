import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { readConfiguration } from '../configuration';
import {
  FLOOD_ADMIN_TOKEN_DIGEST,
  FloodAdminAuthGuard,
} from './admin/flood-admin-auth.guard';
import { FloodAdminController } from './admin/flood-admin.controller';
import { DevFloodController } from './dev/dev-flood.controller';
import { FloodController } from './flood.controller';
import { FLOOD_HAZARD_PROVIDER } from './flood-hazard.provider';
import { RouteFloodEvaluator } from './geometry/route-flood-evaluator';
import {
  FLOOD_HAZARD_LIMITS,
  InMemoryFloodHazardProvider,
} from './providers/in-memory-flood-hazard.provider';

@Module({
  controllers: [FloodController],
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
    const controllers = [
      FloodController,
      ...(config.enableDevFloodEndpoints ? [DevFloodController] : []),
      ...(config.enableFloodAdminEndpoints ? [FloodAdminController] : []),
    ];
    const limitsProvider = {
      provide: FLOOD_HAZARD_LIMITS,
      useValue: {
        maxActiveHazards: config.maxActiveFloodHazards,
        maxPolygonVertices: config.maxFloodPolygonVertices,
      },
    };
    const adminProviders: Provider[] = [];
    if (config.enableFloodAdminEndpoints) {
      const configuredDigest = config.floodAdminTokenSha256;
      if (configuredDigest === undefined) {
        throw new Error(
          'Flood admin token digest is missing from validated configuration',
        );
      }
      adminProviders.push(
        {
          provide: FLOOD_ADMIN_TOKEN_DIGEST,
          useValue: Buffer.from(configuredDigest, 'hex'),
        },
        FloodAdminAuthGuard,
      );
    }

    return {
      module: FloodModule,
      controllers,
      providers: [
        limitsProvider,
        InMemoryFloodHazardProvider,
        {
          provide: FLOOD_HAZARD_PROVIDER,
          useExisting: InMemoryFloodHazardProvider,
        },
        RouteFloodEvaluator,
        ...adminProviders,
      ],
      exports: [
        FLOOD_HAZARD_PROVIDER,
        InMemoryFloodHazardProvider,
        RouteFloodEvaluator,
      ],
    };
  }
}
