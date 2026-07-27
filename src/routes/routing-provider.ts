import type { TravelModeDto } from './dto/route-preview-request.dto';
import type { FloodHazard } from '../flood/models/flood-hazard';

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
  readonly hazards?: readonly FloodHazard[];
}

export enum NavigationManoeuvreType {
  DEPART = 'DEPART',
  CONTINUE = 'CONTINUE',
  TURN = 'TURN',
  SLIGHT_TURN = 'SLIGHT_TURN',
  SHARP_TURN = 'SHARP_TURN',
  U_TURN = 'U_TURN',
  ROUNDABOUT = 'ROUNDABOUT',
  EXIT_ROUNDABOUT = 'EXIT_ROUNDABOUT',
  MERGE = 'MERGE',
  FORK = 'FORK',
  ARRIVE = 'ARRIVE',
  UNKNOWN = 'UNKNOWN',
}

export enum NavigationModifier {
  STRAIGHT = 'STRAIGHT',
  SLIGHT_LEFT = 'SLIGHT_LEFT',
  LEFT = 'LEFT',
  SHARP_LEFT = 'SHARP_LEFT',
  SLIGHT_RIGHT = 'SLIGHT_RIGHT',
  RIGHT = 'RIGHT',
  SHARP_RIGHT = 'SHARP_RIGHT',
  U_TURN = 'U_TURN',
  NONE = 'NONE',
}

export interface ProviderNavigationStep {
  readonly index: number;
  readonly instruction: string;
  readonly streetName: string;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly manoeuvre: {
    readonly type: NavigationManoeuvreType;
    readonly modifier: NavigationModifier;
    readonly bearingBefore: number | null;
    readonly bearingAfter: number | null;
  };
  readonly geometryStartIndex: number;
  readonly geometryEndIndex: number;
}

export interface ProviderRoute {
  readonly geometry: {
    readonly type: 'LineString';
    readonly coordinates: readonly (readonly [number, number])[];
  };
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly steps: readonly ProviderNavigationStep[];
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
