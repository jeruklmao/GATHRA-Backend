import type { FloodHazard, FloodRiskLevel } from '../models/flood-hazard';

export interface EvaluatedRouteFloodRisk {
  readonly level: FloodRiskLevel | 'UNKNOWN';
  readonly score: number;
  readonly intersectsBlockedArea: boolean;
  readonly affectedDistanceMeters: number;
  readonly confidence: number | null;
  readonly reasonCodes: readonly string[];
  readonly evaluatedAt: Date;
  readonly validUntil: Date | null;
  readonly hazardSnapshotId: string | null;
}

const RISK_LEVEL_SEVERITY: Record<FloodRiskLevel, number> = {
  LOW: 0,
  UNKNOWN: 1,
  MEDIUM: 2,
  HIGH: 3,
  BLOCKED: 4,
};

export class RouteFloodEvaluator {
  evaluateRoute(
    coordinates: readonly (readonly [number, number])[],
    totalDistanceMeters: number,
    hazards: readonly FloodHazard[],
    snapshotId: string | null,
    now: Date = new Date(),
  ): EvaluatedRouteFloodRisk {
    if (hazards.length === 0) {
      return {
        level: 'LOW',
        score: 0,
        intersectsBlockedArea: false,
        affectedDistanceMeters: 0,
        confidence: 1.0,
        reasonCodes: ['NO_ACTIVE_FLOOD_INTERSECTION'],
        evaluatedAt: now,
        validUntil: null,
        hazardSnapshotId: snapshotId,
      };
    }

    let highestSeverityLevel: FloodRiskLevel | null = null;
    let highestSeverityNumber = -1;
    let intersectsBlockedArea = false;
    let totalAffectedDistanceMeters = 0;
    let strongestPenalty = 0;
    const intersectedHazards: FloodHazard[] = [];

    for (const hazard of hazards) {
      const affectedDist = calculateRoutePolygonOverlapMeters(
        coordinates,
        hazard.geometry.coordinates,
      );
      if (affectedDist > 0) {
        intersectedHazards.push(hazard);
        totalAffectedDistanceMeters += affectedDist;

        const severity = RISK_LEVEL_SEVERITY[hazard.level];
        if (severity > highestSeverityNumber) {
          highestSeverityNumber = severity;
          highestSeverityLevel = hazard.level;
        }

        strongestPenalty = Math.max(
          strongestPenalty,
          1 - hazard.routingMultiplier,
        );
        if (hazard.routingMultiplier === 0) {
          intersectsBlockedArea = true;
        }
      }
    }

    if (intersectedHazards.length === 0) {
      return {
        level: 'LOW',
        score: 0,
        intersectsBlockedArea: false,
        affectedDistanceMeters: 0,
        confidence: 0.9,
        reasonCodes: ['NO_ACTIVE_FLOOD_INTERSECTION'],
        evaluatedAt: now,
        validUntil: earliestValidUntil(hazards),
        hazardSnapshotId: snapshotId,
      };
    }

    const level = highestSeverityLevel!;
    const score = intersectsBlockedArea
      ? 1
      : Math.min(1, strongestPenalty);

    const avgConfidence =
      intersectedHazards.reduce((sum, h) => sum + h.confidence, 0) /
      intersectedHazards.length;

    const reasonCodes: string[] = [];
    if (intersectsBlockedArea) {
      // Retain the established Android-facing reason code. Its triggering
      // condition is now the runtime zero multiplier, not the level name.
      reasonCodes.push('BLOCKED_HAZARD_INTERSECTION');
    } else if (strongestPenalty === 0) {
      reasonCodes.push('MONITORED_AREA_INTERSECTION_NO_ROUTING_PENALTY');
    } else {
      reasonCodes.push('FLOOD_HAZARD_INTERSECTION');
    }

    return {
      level,
      score,
      intersectsBlockedArea,
      affectedDistanceMeters: Math.round(totalAffectedDistanceMeters),
      confidence: Number(avgConfidence.toFixed(2)),
      reasonCodes,
      evaluatedAt: now,
      validUntil: earliestValidUntil(intersectedHazards),
      hazardSnapshotId: snapshotId,
    };
  }
}

export function isPointInsidePolygon(
  point: readonly [number, number],
  rings: readonly (readonly (readonly [number, number])[])[],
): boolean {
  if (rings.length === 0) return false;
  const outerRing = rings[0];
  if (!isPointInRing(point, outerRing)) {
    return false;
  }
  // Check holes (inner rings)
  for (let i = 1; i < rings.length; i += 1) {
    if (isPointInRing(point, rings[i])) {
      return false; // Point is inside a hole
    }
  }
  return true;
}

function isPointInRing(
  point: readonly [number, number],
  ring: readonly (readonly [number, number])[],
): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

function calculateRoutePolygonOverlapMeters(
  coordinates: readonly (readonly [number, number])[],
  rings: readonly (readonly (readonly [number, number])[])[],
): number {
  if (coordinates.length < 2) return 0;
  let affectedMeters = 0;

  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const p1 = coordinates[i];
    const p2 = coordinates[i + 1];
    const segDist = haversineDistanceMeters(p1, p2);

    const p1Inside = isPointInsidePolygon(p1, rings);
    const p2Inside = isPointInsidePolygon(p2, rings);

    if (p1Inside && p2Inside) {
      affectedMeters += segDist;
    } else if (p1Inside || p2Inside || segmentCrossesPolygon(p1, p2, rings)) {
      // Approximate affected portion
      affectedMeters += segDist * 0.5;
    }
  }

  return affectedMeters;
}

function segmentCrossesPolygon(
  p1: readonly [number, number],
  p2: readonly [number, number],
  rings: readonly (readonly (readonly [number, number])[])[],
): boolean {
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i += 1) {
      const q1 = ring[i];
      const q2 = ring[i + 1];
      if (segmentsIntersect(p1, p2, q1, q2)) {
        return true;
      }
    }
  }
  return false;
}

function segmentsIntersect(
  p1: readonly [number, number],
  p2: readonly [number, number],
  q1: readonly [number, number],
  q2: readonly [number, number],
): boolean {
  const ccw = (
    a: readonly [number, number],
    b: readonly [number, number],
    c: readonly [number, number],
  ) => (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);

  return (
    ccw(p1, q1, q2) !== ccw(p2, q1, q2) && ccw(p1, p2, q1) !== ccw(p1, p2, q2)
  );
}

function haversineDistanceMeters(
  c1: readonly [number, number],
  c2: readonly [number, number],
): number {
  const EARTH_RADIUS = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(c2[1] - c1[1]);
  const dLon = toRad(c2[0] - c1[0]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(c1[1])) *
      Math.cos(toRad(c2[1])) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
}

function earliestValidUntil(hazards: readonly FloodHazard[]): Date | null {
  if (hazards.length === 0) return null;
  let earliest: Date | null = null;
  for (const hazard of hazards) {
    if (
      hazard.validUntil !== null &&
      (earliest === null || hazard.validUntil.getTime() < earliest.getTime())
    ) {
      earliest = hazard.validUntil;
    }
  }
  return earliest;
}
