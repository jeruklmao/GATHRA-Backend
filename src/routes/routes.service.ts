import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ApiException } from '../common/api-error';
import {
  FLOOD_HAZARD_PROVIDER,
  type FloodHazardProvider,
} from '../flood/flood-hazard.provider';
import {
  isPointInsidePolygon,
  type EvaluatedRouteFloodRisk,
  RouteFloodEvaluator,
} from '../flood/geometry/route-flood-evaluator';
import type { FloodHazard } from '../flood/models/flood-hazard';
import type { RoutePreviewRequestDto } from './dto/route-preview-request.dto';
import type {
  RouteDto,
  RoutePreviewResponseDto,
  RouteRiskDto,
} from './dto/route-preview-response.dto';
import {
  type ProviderRoute,
  ROUTING_PROVIDER,
  type RoutingProvider,
  RoutingProviderError,
} from './routing-provider';

const RISK_LEVEL_SEVERITY: Record<string, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  BLOCKED: 4,
  UNKNOWN: 5,
};

@Injectable()
export class RoutesService {
  constructor(
    @Inject(ROUTING_PROVIDER)
    private readonly routingProvider: RoutingProvider,
    @Inject(FLOOD_HAZARD_PROVIDER)
    private readonly floodHazardProvider: FloodHazardProvider,
    private readonly routeFloodEvaluator: RouteFloodEvaluator,
  ) {}

  async preview(
    requestId: string,
    request: RoutePreviewRequestDto,
  ): Promise<RoutePreviewResponseDto> {
    if (
      request.origin.latitude === request.destination.latitude &&
      request.origin.longitude === request.destination.longitude
    ) {
      throw ApiException.validation([
        {
          field: 'destination',
          reason: 'must differ from origin',
        },
      ]);
    }

    const now = new Date();
    const snapshot = await this.floodHazardProvider.getActiveSnapshot({
      origin: request.origin,
      destination: request.destination,
      observedAt: now,
    });

    const originPoint: [number, number] = [
      request.origin.longitude,
      request.origin.latitude,
    ];
    const destinationPoint: [number, number] = [
      request.destination.longitude,
      request.destination.latitude,
    ];

    const blockedHazards = snapshot.hazards.filter((h) => h.level === 'BLOCKED');
    for (const blockedHazard of blockedHazards) {
      if (isPointInsidePolygon(originPoint, blockedHazard.geometry.coordinates)) {
        throw new ApiException(
          422,
          'ORIGIN_IN_BLOCKED_AREA',
          'Origin point is located inside a blocked flood area.',
          false,
        );
      }
      if (
        isPointInsidePolygon(
          destinationPoint,
          blockedHazard.geometry.coordinates,
        )
      ) {
        throw new ApiException(
          422,
          'DESTINATION_IN_BLOCKED_AREA',
          'Destination point is located inside a blocked flood area.',
          false,
        );
      }
    }

    try {
      let providerRoutes: readonly ProviderRoute[];
      try {
        providerRoutes = await this.routingProvider.preview({
          ...request,
          hazards: snapshot.hazards,
        });
      } catch (error) {
        if (
          error instanceof RoutingProviderError &&
          error.kind === 'NO_ROUTE' &&
          blockedHazards.length > 0
        ) {
          // Diagnostic check without hazards to see if flood caused the block
          try {
            const baselineRoutes = await this.routingProvider.preview({
              ...request,
              hazards: [],
            });
            if (baselineRoutes.length > 0) {
              throw new ApiException(
                422,
                'NO_ROUTE_DUE_TO_FLOOD',
                'No route could be found that avoids blocked flood areas.',
                false,
              );
            }
          } catch (baselineError) {
            if (baselineError instanceof ApiException) {
              throw baselineError;
            }
          }
        }
        throw error;
      }

      if (providerRoutes.length === 0) {
        throw new RoutingProviderError('NO_ROUTE');
      }

      const evaluatedRoutes = providerRoutes
        .slice(0, request.alternatives + 1)
        .map((providerRoute) => {
          const risk = this.routeFloodEvaluator.evaluateRoute(
            providerRoute.geometry.coordinates,
            providerRoute.distanceMeters,
            snapshot.hazards,
            snapshot.snapshotId,
            now,
          );
          return {
            providerRoute,
            risk,
          };
        });

      // Rank routes:
      // 1. Unblocked routes before blocked routes
      // 2. Lower flood risk level
      // 3. Lower risk score
      // 4. Higher confidence
      // 5. Shorter duration
      // 6. Shorter distance
      // 7. Stable route ID
      evaluatedRoutes.sort((a, b) => {
        if (a.risk.intersectsBlockedArea !== b.risk.intersectsBlockedArea) {
          return a.risk.intersectsBlockedArea ? 1 : -1;
        }
        const aSev = RISK_LEVEL_SEVERITY[a.risk.level] ?? 5;
        const bSev = RISK_LEVEL_SEVERITY[b.risk.level] ?? 5;
        if (aSev !== bSev) {
          return aSev - bSev;
        }
        if (a.risk.score !== b.risk.score) {
          return a.risk.score - b.risk.score;
        }
        const aConf = a.risk.confidence ?? 0;
        const bConf = b.risk.confidence ?? 0;
        if (aConf !== bConf) {
          return bConf - aConf;
        }
        if (a.providerRoute.durationSeconds !== b.providerRoute.durationSeconds) {
          return a.providerRoute.durationSeconds - b.providerRoute.durationSeconds;
        }
        if (a.providerRoute.distanceMeters !== b.providerRoute.distanceMeters) {
          return a.providerRoute.distanceMeters - b.providerRoute.distanceMeters;
        }
        const aId = stableRouteId(
          request.travelMode,
          a.providerRoute.geometry.coordinates,
        );
        const bId = stableRouteId(
          request.travelMode,
          b.providerRoute.geometry.coordinates,
        );
        return aId.localeCompare(bId);
      });

      const routes: RouteDto[] = evaluatedRoutes.map(
        ({ providerRoute, risk }, index) =>
          mapRoute(
            providerRoute,
            request.travelMode,
            risk,
            index === 0, // Top ranked route is recommended
          ),
      );

      return {
        requestId,
        routes,
        metadata: {
          travelMode: request.travelMode,
          requestedAlternatives: request.alternatives,
          returnedAlternatives: Math.max(0, routes.length - 1),
          flood: {
            source: snapshot.source,
            snapshotId: snapshot.snapshotId,
            evaluatedAt: now.toISOString(),
            validUntil: snapshot.validUntil
              ? snapshot.validUntil.toISOString()
              : null,
            activeHazardCount: snapshot.hazards.length,
          },
        },
      };
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }
      if (!(error instanceof RoutingProviderError)) {
        throw error;
      }
      throw mapProviderError(error);
    }
  }
}

function mapRoute(
  route: ProviderRoute,
  travelMode: RoutePreviewRequestDto['travelMode'],
  risk: EvaluatedRouteFloodRisk,
  isRecommended: boolean,
): RouteDto {
  const coordinates = route.geometry.coordinates.map(
    ([longitude, latitude]) => [longitude, latitude] as [number, number],
  );

  const riskDto: RouteRiskDto = {
    level: risk.level,
    score: risk.score,
    intersectsBlockedArea: risk.intersectsBlockedArea,
    affectedDistanceMeters: risk.affectedDistanceMeters,
    confidence: risk.confidence,
    reasonCodes: [...risk.reasonCodes],
    evaluatedAt: risk.evaluatedAt.toISOString(),
    validUntil: risk.validUntil ? risk.validUntil.toISOString() : null,
    hazardSnapshotId: risk.hazardSnapshotId,
  };

  return {
    id: stableRouteId(travelMode, coordinates),
    isRecommended,
    risk: riskDto,
    geometry: {
      type: 'LineString',
      coordinates,
    },
    summary: {
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
    },
    steps: route.steps.map((step) => ({
      index: step.index,
      instruction: step.instruction,
      streetName: step.streetName,
      distanceMeters: step.distanceMeters,
      durationSeconds: step.durationSeconds,
      manoeuvre: {
        type: step.manoeuvre.type,
        modifier: step.manoeuvre.modifier,
        bearingBefore: step.manoeuvre.bearingBefore,
        bearingAfter: step.manoeuvre.bearingAfter,
      },
      geometryStartIndex: step.geometryStartIndex,
      geometryEndIndex: step.geometryEndIndex,
    })),
  };
}

function stableRouteId(
  travelMode: RoutePreviewRequestDto['travelMode'],
  coordinates: readonly (readonly [number, number])[],
): string {
  const canonicalCoordinates = coordinates
    .map(([longitude, latitude]) => `${longitude.toFixed(6)},${latitude.toFixed(6)}`)
    .join(';');
  const fingerprint = createHash('sha256')
    .update(`v1|${travelMode}|${canonicalCoordinates}`)
    .digest('hex')
    .slice(0, 16);
  return `route_${fingerprint}`;
}

function mapProviderError(error: RoutingProviderError): ApiException {
  switch (error.kind) {
    case 'NO_ROUTE':
      return new ApiException(
        422,
        'NO_ROUTE',
        'No route could be found between the selected points.',
        false,
      );
    case 'TIMEOUT':
      return new ApiException(
        504,
        'ROUTING_TIMEOUT',
        'The routing engine did not respond in time.',
        true,
      );
    case 'INVALID_RESPONSE':
      return new ApiException(
        502,
        'ROUTING_RESPONSE_INVALID',
        'The routing engine returned an invalid response.',
        true,
      );
    case 'UNAVAILABLE':
      return new ApiException(
        503,
        'ROUTING_UNAVAILABLE',
        'The routing engine is temporarily unavailable.',
        true,
      );
  }
}
