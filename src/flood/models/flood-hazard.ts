import type { RoutingPoint } from '../../routes/routing-provider';

export type FloodRiskLevel =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'BLOCKED'
  | 'UNKNOWN';

export interface GeoJsonPolygon {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly (readonly [number, number])[])[];
}

export interface FloodHazard {
  readonly id: string;
  readonly level: FloodRiskLevel;
  readonly geometry: GeoJsonPolygon;
  readonly confidence: number;
  readonly observedAt: Date | null;
  readonly validUntil: Date | null;
  readonly sourceNodeIds: readonly string[];
  readonly routingMultiplier: number;
  readonly reasonCodes?: readonly string[];
  readonly freshness?: 'FRESH' | 'STALE' | 'NO_TELEMETRY';
  readonly description?: string;
}

export interface FloodHazardSnapshot {
  readonly snapshotId: string;
  readonly generatedAt: Date;
  readonly validUntil: Date | null;
  readonly hazards: readonly FloodHazard[];
  readonly source: 'SIMULATED' | 'SENSOR';
}

export interface FloodHazardQueryInput {
  readonly origin?: RoutingPoint;
  readonly destination?: RoutingPoint;
  readonly observedAt?: Date;
}
