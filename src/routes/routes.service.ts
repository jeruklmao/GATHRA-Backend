import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ApiException } from '../common/api-error';
import {
  type RouteDto,
  type RoutePreviewResponseDto,
} from './dto/route-preview-response.dto';
import type { RoutePreviewRequestDto } from './dto/route-preview-request.dto';
import {
  type ProviderRoute,
  ROUTING_PROVIDER,
  type RoutingProvider,
  RoutingProviderError,
} from './routing-provider';

@Injectable()
export class RoutesService {
  constructor(
    @Inject(ROUTING_PROVIDER)
    private readonly routingProvider: RoutingProvider,
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

    try {
      const providerRoutes = await this.routingProvider.preview(request);
      if (providerRoutes.length === 0) {
        throw new RoutingProviderError('NO_ROUTE');
      }
      const routes = providerRoutes
        .slice(0, request.alternatives + 1)
        .map((route, index) => mapRoute(route, request.travelMode, index === 0));
      return {
        requestId,
        routes,
        metadata: {
          travelMode: request.travelMode,
          requestedAlternatives: request.alternatives,
          returnedAlternatives: Math.max(0, routes.length - 1),
        },
      };
    } catch (error) {
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
  isRecommended: boolean,
): RouteDto {
  const coordinates = route.geometry.coordinates.map(
    ([longitude, latitude]) => [longitude, latitude] as [number, number],
  );
  return {
    id: stableRouteId(travelMode, coordinates),
    isRecommended,
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
