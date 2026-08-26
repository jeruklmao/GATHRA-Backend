import { createHash } from 'node:crypto';
import type { FloodHazard, GeoJsonPolygon } from '../models/flood-hazard';

export const MAX_ACTIVE_FLOOD_HAZARDS = 50;
export const MAX_FLOOD_POLYGON_VERTICES = 2000;
export const MIN_RING_POINTS = 4; // closed ring: start point + at least 2 distinct points + end point (same as start)

export interface FloodGeometryValidationLimits {
  readonly maxPolygonVertices: number;
}

export class FloodGeometryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FloodGeometryValidationError';
  }
}

export function validateFloodHazard(
  hazard: unknown,
  limits: FloodGeometryValidationLimits = {
    maxPolygonVertices: MAX_FLOOD_POLYGON_VERTICES,
  },
): FloodHazard {
  if (!isRecord(hazard)) {
    throw new FloodGeometryValidationError('Hazard must be an object');
  }

  if (typeof hazard.id !== 'string' || hazard.id.trim() === '') {
    throw new FloodGeometryValidationError('Hazard id must be a non-empty string');
  }

  const allowedLevels = ['LOW', 'MEDIUM', 'HIGH', 'BLOCKED', 'UNKNOWN'];
  if (typeof hazard.level !== 'string' || !allowedLevels.includes(hazard.level)) {
    throw new FloodGeometryValidationError(
      `Hazard level must be one of: ${allowedLevels.join(', ')}`,
    );
  }

  if (
    typeof hazard.confidence !== 'number' ||
    !Number.isFinite(hazard.confidence) ||
    hazard.confidence < 0 ||
    hazard.confidence > 1
  ) {
    throw new FloodGeometryValidationError(
      'Hazard confidence must be a finite number between 0 and 1',
    );
  }

  const observedAt = parseDate(hazard.observedAt, 'observedAt');
  const validUntil = parseDate(hazard.validUntil, 'validUntil');

  if (validUntil.getTime() <= observedAt.getTime()) {
    throw new FloodGeometryValidationError(
      'validUntil must be strictly later than observedAt',
    );
  }

  const sourceNodeIds = Array.isArray(hazard.sourceNodeIds)
    ? hazard.sourceNodeIds.filter((id): id is string => typeof id === 'string')
    : [];

  const geometry = validateGeoJsonPolygon(
    hazard.geometry,
    limits.maxPolygonVertices,
  );

  const routingMultiplier =
    hazard.routingMultiplier === undefined
      ? defaultSimulationMultiplier(hazard.level as FloodHazard['level'])
      : hazard.routingMultiplier;
  if (
    typeof routingMultiplier !== 'number' ||
    !Number.isFinite(routingMultiplier) ||
    routingMultiplier < 0 ||
    routingMultiplier > 1
  ) {
    throw new FloodGeometryValidationError(
      'Hazard routingMultiplier must be a finite number between 0 and 1',
    );
  }

  return {
    id: hazard.id.trim(),
    level: hazard.level as FloodHazard['level'],
    geometry,
    confidence: hazard.confidence,
    observedAt,
    validUntil,
    sourceNodeIds,
    routingMultiplier,
    reasonCodes: Array.isArray(hazard.reasonCodes)
      ? hazard.reasonCodes.filter(
          (reason): reason is string => typeof reason === 'string',
        )
      : undefined,
    description: typeof hazard.description === 'string' ? hazard.description : undefined,
  };
}

export function validateGeoJsonPolygon(
  geometry: unknown,
  maxPolygonVertices: number = MAX_FLOOD_POLYGON_VERTICES,
): GeoJsonPolygon {
  if (!Number.isSafeInteger(maxPolygonVertices) || maxPolygonVertices < MIN_RING_POINTS) {
    throw new FloodGeometryValidationError(
      `Maximum polygon vertex limit must be an integer of at least ${MIN_RING_POINTS}`,
    );
  }
  if (!isRecord(geometry) || geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) {
    throw new FloodGeometryValidationError(
      'Geometry must be a GeoJSON Polygon with a coordinates array',
    );
  }

  if (geometry.coordinates.length === 0) {
    throw new FloodGeometryValidationError('Polygon coordinates must contain at least one ring');
  }

  let totalVertices = 0;
  const validatedRings: [number, number][][] = [];

  for (const ring of geometry.coordinates) {
    if (!Array.isArray(ring) || ring.length < MIN_RING_POINTS) {
      throw new FloodGeometryValidationError(
        `Polygon ring must contain at least ${MIN_RING_POINTS} points`,
      );
    }

    const validatedRing: [number, number][] = [];
    for (const point of ring) {
      if (!Array.isArray(point) || point.length !== 2) {
        throw new FloodGeometryValidationError(
          'Polygon coordinate point must be an array of [longitude, latitude]',
        );
      }
      const [lng, lat] = point;
      if (
        typeof lng !== 'number' ||
        typeof lat !== 'number' ||
        !Number.isFinite(lng) ||
        !Number.isFinite(lat) ||
        lng < -180 ||
        lng > 180 ||
        lat < -90 ||
        lat > 90
      ) {
        throw new FloodGeometryValidationError(
          `Invalid coordinate values [${lng}, ${lat}]. Longitude must be [-180..180] and latitude [-90..90].`,
        );
      }
      validatedRing.push([lng, lat]);
    }

    // Check closed ring condition
    const first = validatedRing[0];
    const last = validatedRing[validatedRing.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      throw new FloodGeometryValidationError(
        'Polygon ring must be closed (first and last coordinate must match exactly)',
      );
    }

    const distinctPoints = new Set(
      validatedRing
        .slice(0, -1)
        .map(([longitude, latitude]) => `${longitude}\u0000${latitude}`),
    );
    if (distinctPoints.size < 3) {
      throw new FloodGeometryValidationError(
        'Polygon ring must contain at least three distinct vertices',
      );
    }
    for (let index = 1; index < validatedRing.length; index += 1) {
      const previous = validatedRing[index - 1];
      const current = validatedRing[index];
      if (previous[0] === current[0] && previous[1] === current[1]) {
        throw new FloodGeometryValidationError(
          'Polygon ring must not contain zero-length edges',
        );
      }
    }
    if (ringHasSelfIntersection(validatedRing)) {
      throw new FloodGeometryValidationError(
        'Polygon ring must not self-intersect',
      );
    }
    if (Math.abs(signedRingArea(validatedRing)) < 1e-15) {
      throw new FloodGeometryValidationError(
        'Polygon ring must enclose a non-zero area',
      );
    }

    totalVertices += validatedRing.length;
    validatedRings.push(validatedRing);
  }

  if (totalVertices > maxPolygonVertices) {
    throw new FloodGeometryValidationError(
      `Polygon exceeds maximum vertex limit of ${maxPolygonVertices} (got ${totalVertices})`,
    );
  }

  return {
    type: 'Polygon',
    coordinates: validatedRings,
  };
}

function defaultSimulationMultiplier(level: FloodHazard['level']): number {
  switch (level) {
    case 'LOW':
    case 'UNKNOWN':
      return 1;
    case 'MEDIUM':
      return 0.35;
    case 'HIGH':
      return 0.05;
    case 'BLOCKED':
      return 0;
  }
}

function signedRingArea(ring: readonly (readonly [number, number])[]): number {
  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    twiceArea +=
      ring[index][0] * ring[index + 1][1] -
      ring[index + 1][0] * ring[index][1];
  }
  return twiceArea / 2;
}

function ringHasSelfIntersection(
  ring: readonly (readonly [number, number])[],
): boolean {
  const segmentCount = ring.length - 1;
  for (let first = 0; first < segmentCount; first += 1) {
    for (let second = first + 1; second < segmentCount; second += 1) {
      const adjacent = second === first + 1;
      const closureAdjacent = first === 0 && second === segmentCount - 1;
      if (adjacent || closureAdjacent) continue;
      if (
        segmentsTouchOrIntersect(
          ring[first],
          ring[first + 1],
          ring[second],
          ring[second + 1],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function segmentsTouchOrIntersect(
  firstStart: readonly [number, number],
  firstEnd: readonly [number, number],
  secondStart: readonly [number, number],
  secondEnd: readonly [number, number],
): boolean {
  const o1 = orientation(firstStart, firstEnd, secondStart);
  const o2 = orientation(firstStart, firstEnd, secondEnd);
  const o3 = orientation(secondStart, secondEnd, firstStart);
  const o4 = orientation(secondStart, secondEnd, firstEnd);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && pointOnSegment(secondStart, firstStart, firstEnd)) ||
    (o2 === 0 && pointOnSegment(secondEnd, firstStart, firstEnd)) ||
    (o3 === 0 && pointOnSegment(firstStart, secondStart, secondEnd)) ||
    (o4 === 0 && pointOnSegment(firstEnd, secondStart, secondEnd))
  );
}

function orientation(
  first: readonly [number, number],
  second: readonly [number, number],
  third: readonly [number, number],
): -1 | 0 | 1 {
  const cross =
    (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0]);
  if (Math.abs(cross) <= 1e-15) return 0;
  return cross > 0 ? 1 : -1;
}

function pointOnSegment(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
): boolean {
  return (
    point[0] >= Math.min(start[0], end[0]) &&
    point[0] <= Math.max(start[0], end[0]) &&
    point[1] >= Math.min(start[1], end[1]) &&
    point[1] <= Math.max(start[1], end[1])
  );
}

export function generateSafeAreaId(hazardId: string): string {
  const hash = createHash('sha256').update(hazardId).digest('hex').slice(0, 12);
  return `flood_area_${hash}`;
}

function parseDate(value: unknown, fieldName: string): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d;
    }
  }
  throw new FloodGeometryValidationError(`${fieldName} must be a valid Date or ISO string`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
