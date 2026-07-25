import type { TravelModeDto } from './dto/route-preview-request.dto';

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');

export interface RoutingPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface RoutingProviderRequest {
  readonly origin: RoutingPoint;
  readonly destination: RoutingPoint;
  readonly travelMode: TravelModeDto;
  readonly alternatives: number;
}

export interface ProviderRoute {
  readonly geometry: {
    readonly type: 'LineString';
    readonly coordinates: readonly (readonly [number, number])[];
  };
  readonly distanceMeters: number;
  readonly durationSeconds: number;
}

export interface RoutingProvider {
  preview(request: RoutingProviderRequest): Promise<readonly ProviderRoute[]>;
  health(): Promise<void>;
}

export type RoutingProviderErrorKind =
  | 'NO_ROUTE'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'UNAVAILABLE';

export class RoutingProviderError extends Error {
  constructor(
    readonly kind: RoutingProviderErrorKind,
    options?: ErrorOptions,
  ) {
    super(kind, options);
    this.name = 'RoutingProviderError';
  }
}
