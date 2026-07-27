import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readConfiguration } from '../configuration';
import { TravelModeDto } from './dto/route-preview-request.dto';
import {
  NavigationManoeuvreType,
  NavigationModifier,
  type ProviderNavigationStep,
  type ProviderRoute,
  type RoutingProvider,
  RoutingProviderError,
  type RoutingProviderRequest,
} from './routing-provider';

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_GEOMETRY_POINTS = 50_000;
const MAX_NAVIGATION_STEPS = 50_000;
const MAX_INSTRUCTION_LENGTH = 1_000;
const MAX_ENDPOINT_SNAP_DISTANCE_METERS = 500;
const EARTH_RADIUS_METERS = 6_371_000;

const PROFILE_BY_TRAVEL_MODE: Readonly<Record<TravelModeDto, string>> = {
  [TravelModeDto.CAR]: 'car',
  [TravelModeDto.MOTORCYCLE]: 'motorcycle',
};

@Injectable()
export class GraphHopperClient implements RoutingProvider {
  private readonly baseUrl = readConfiguration().routingEngineBaseUrl;
  private readonly timeoutMs = readConfiguration().routingEngineTimeoutMs;

  async preview(
    request: RoutingProviderRequest,
  ): Promise<readonly ProviderRoute[]> {
    const payload: Record<string, unknown> = {
      profile: PROFILE_BY_TRAVEL_MODE[request.travelMode],
      points: [
        [request.origin.longitude, request.origin.latitude],
        [request.destination.longitude, request.destination.latitude],
      ],
      points_encoded: false,
      instructions: true,
      locale: 'id',
      calc_points: true,
      timeout_ms: this.timeoutMs,
    };
    if (request.alternatives > 0) {
      payload.algorithm = 'alternative_route';
      payload['ch.disable'] = true;
      payload['alternative_route.max_paths'] = request.alternatives + 1;
      payload['alternative_route.max_weight_factor'] = 1.6;
      payload['alternative_route.max_share_factor'] = 0.8;
      // The default exploration factor is intentionally conservative and can miss
      // useful alternatives on small or sparse extracts. Keep this bounded and
      // provider-private so the public API remains independent from GraphHopper.
      payload['alternative_route.max_exploration_factor'] = 2.0;
      payload['alternative_route.min_plateau_factor'] = 0.05;
    }

    const response = await this.fetchJson(`${this.baseUrl}/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const paths = parseGraphHopperResponse(response);
    const uniquePaths = deduplicateRoutes(paths);
    const routesNearRequestedPoints = uniquePaths.filter((route) =>
      hasAcceptableEndpointSnapping(route, request),
    );
    if (routesNearRequestedPoints.length === 0) {
      throw new RoutingProviderError('NO_ROUTE');
    }
    return routesNearRequestedPoints.slice(0, request.alternatives + 1);
  }

  async health(): Promise<void> {
    const payload = await this.fetchJson(`${this.baseUrl}/info`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!isRecord(payload)) {
      throw new RoutingProviderError('INVALID_RESPONSE');
    }
  }

  private async fetchJson(
    url: string,
    init: RequestInit,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        redirect: 'error',
      });
      const declaredLength = Number(response.headers.get('content-length'));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_BYTES
      ) {
        throw new RoutingProviderError('INVALID_RESPONSE');
      }

      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new RoutingProviderError('INVALID_RESPONSE');
      }

      if (!response.ok) {
        throw classifyHttpFailure(response.status, text);
      }

      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        throw new RoutingProviderError('INVALID_RESPONSE', { cause: error });
      }
    } catch (error) {
      if (error instanceof RoutingProviderError) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new RoutingProviderError('TIMEOUT', { cause: error });
      }
      throw new RoutingProviderError('UNAVAILABLE', { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseGraphHopperResponse(payload: unknown): ProviderRoute[] {
  if (!isRecord(payload) || !Array.isArray(payload.paths)) {
    throw new RoutingProviderError('INVALID_RESPONSE');
  }
  if (payload.paths.length === 0) {
    throw new RoutingProviderError('NO_ROUTE');
  }
  return payload.paths.map((path) => parsePath(path));
}

function parsePath(path: unknown): ProviderRoute {
  if (
    !isRecord(path) ||
    !isPositiveFiniteNumber(path.distance) ||
    !isPositiveFiniteNumber(path.time) ||
    !isRecord(path.points) ||
    path.points.type !== 'LineString' ||
    !Array.isArray(path.points.coordinates) ||
    path.points.coordinates.length < 2 ||
    path.points.coordinates.length > MAX_GEOMETRY_POINTS
  ) {
    throw new RoutingProviderError('INVALID_RESPONSE');
  }

  const coordinates = path.points.coordinates.map((coordinate) =>
    parseCoordinate(coordinate),
  );
  const steps = parseInstructions(path.instructions, coordinates);
  return {
    geometry: {
      type: 'LineString',
      coordinates,
    },
    distanceMeters: Math.max(1, Math.round(path.distance)),
    durationSeconds: Math.max(1, Math.ceil(path.time / 1_000)),
    steps,
  };
}

function parseInstructions(
  instructions: unknown,
  coordinates: readonly (readonly [number, number])[],
): ProviderNavigationStep[] {
  if (
    !Array.isArray(instructions) ||
    instructions.length < 2 ||
    instructions.length > MAX_NAVIGATION_STEPS
  ) {
    throw new RoutingProviderError('INVALID_RESPONSE');
  }

  const steps = instructions.map((instruction, index) =>
    parseInstruction(instruction, index, coordinates),
  );
  const lastGeometryIndex = coordinates.length - 1;

  if (
    steps[0].geometryStartIndex !== 0 ||
    steps[steps.length - 1].geometryStartIndex !== lastGeometryIndex ||
    steps[steps.length - 1].geometryEndIndex !== lastGeometryIndex ||
    steps[steps.length - 1].manoeuvre.type !== NavigationManoeuvreType.ARRIVE
  ) {
    throw new RoutingProviderError('INVALID_RESPONSE');
  }

  for (let index = 1; index < steps.length; index += 1) {
    const previous = steps[index - 1];
    const current = steps[index];
    if (
      current.geometryStartIndex !== previous.geometryEndIndex ||
      (index < steps.length - 1 &&
        current.manoeuvre.type === NavigationManoeuvreType.ARRIVE)
    ) {
      throw new RoutingProviderError('INVALID_RESPONSE');
    }
  }

  return steps;
}

function parseInstruction(
  instruction: unknown,
  index: number,
  coordinates: readonly (readonly [number, number])[],
): ProviderNavigationStep {
  if (
    !isRecord(instruction) ||
    !isInteger(instruction.sign) ||
    typeof instruction.text !== 'string' ||
    instruction.text.length === 0 ||
    instruction.text.length > MAX_INSTRUCTION_LENGTH ||
    typeof instruction.street_name !== 'string' ||
    instruction.street_name.length > MAX_INSTRUCTION_LENGTH ||
    !isNonNegativeFiniteNumber(instruction.distance) ||
    !isNonNegativeFiniteNumber(instruction.time) ||
    !Array.isArray(instruction.interval) ||
    instruction.interval.length !== 2 ||
    !isNonNegativeInteger(instruction.interval[0]) ||
    !isNonNegativeInteger(instruction.interval[1])
  ) {
    throw new RoutingProviderError('INVALID_RESPONSE');
  }

  const [geometryStartIndex, geometryEndIndex] = instruction.interval;
  if (
    geometryStartIndex > geometryEndIndex ||
    geometryEndIndex >= coordinates.length
  ) {
    throw new RoutingProviderError('INVALID_RESPONSE');
  }

  const bearingBefore = bearingBeforeIndex(coordinates, geometryStartIndex);
  const bearingAfter = bearingAfterIndex(coordinates, geometryStartIndex);
  const manoeuvre = mapManoeuvre(
    instruction.sign,
    index === 0,
    bearingBefore,
    bearingAfter,
  );

  return {
    index,
    instruction: instruction.text,
    streetName: instruction.street_name,
    distanceMeters: Math.max(0, Math.round(instruction.distance)),
    durationSeconds: Math.max(0, Math.ceil(instruction.time / 1_000)),
    manoeuvre: {
      type: manoeuvre.type,
      modifier: manoeuvre.modifier,
      bearingBefore,
      bearingAfter:
        manoeuvre.type === NavigationManoeuvreType.ARRIVE
          ? null
          : bearingAfter,
    },
    geometryStartIndex,
    geometryEndIndex,
  };
}

function mapManoeuvre(
  sign: number,
  isFirst: boolean,
  bearingBefore: number | null,
  bearingAfter: number | null,
): {
  readonly type: NavigationManoeuvreType;
  readonly modifier: NavigationModifier;
} {
  if (sign === 4 || sign === 5) {
    return {
      type: NavigationManoeuvreType.ARRIVE,
      modifier: NavigationModifier.NONE,
    };
  }
  if (isFirst) {
    return {
      type: NavigationManoeuvreType.DEPART,
      modifier: modifierForSign(sign, bearingBefore, bearingAfter),
    };
  }

  switch (sign) {
    case 0:
      return {
        type: NavigationManoeuvreType.CONTINUE,
        modifier: NavigationModifier.STRAIGHT,
      };
    case -1:
    case 1:
      return {
        type: NavigationManoeuvreType.SLIGHT_TURN,
        modifier:
          sign < 0
            ? NavigationModifier.SLIGHT_LEFT
            : NavigationModifier.SLIGHT_RIGHT,
      };
    case -2:
    case 2:
      return {
        type: NavigationManoeuvreType.TURN,
        modifier:
          sign < 0 ? NavigationModifier.LEFT : NavigationModifier.RIGHT,
      };
    case -3:
    case 3:
      return {
        type: NavigationManoeuvreType.SHARP_TURN,
        modifier:
          sign < 0
            ? NavigationModifier.SHARP_LEFT
            : NavigationModifier.SHARP_RIGHT,
      };
    case -98:
    case -8:
    case 8:
      return {
        type: NavigationManoeuvreType.U_TURN,
        modifier: NavigationModifier.U_TURN,
      };
    case 6:
      return {
        type: NavigationManoeuvreType.ROUNDABOUT,
        modifier: modifierFromBearings(bearingBefore, bearingAfter),
      };
    case -6:
      return {
        type: NavigationManoeuvreType.EXIT_ROUNDABOUT,
        modifier: modifierFromBearings(bearingBefore, bearingAfter),
      };
    case -7:
    case 7:
      return {
        type: NavigationManoeuvreType.FORK,
        modifier:
          sign < 0
            ? NavigationModifier.SLIGHT_LEFT
            : NavigationModifier.SLIGHT_RIGHT,
      };
    default:
      return {
        type: NavigationManoeuvreType.UNKNOWN,
        modifier: NavigationModifier.NONE,
      };
  }
}

function modifierForSign(
  sign: number,
  bearingBefore: number | null,
  bearingAfter: number | null,
): NavigationModifier {
  switch (sign) {
    case -1:
      return NavigationModifier.SLIGHT_LEFT;
    case -2:
      return NavigationModifier.LEFT;
    case -3:
      return NavigationModifier.SHARP_LEFT;
    case 1:
      return NavigationModifier.SLIGHT_RIGHT;
    case 2:
      return NavigationModifier.RIGHT;
    case 3:
      return NavigationModifier.SHARP_RIGHT;
    case -98:
    case -8:
    case 8:
      return NavigationModifier.U_TURN;
    default:
      return modifierFromBearings(bearingBefore, bearingAfter);
  }
}

function modifierFromBearings(
  bearingBefore: number | null,
  bearingAfter: number | null,
): NavigationModifier {
  if (bearingBefore === null || bearingAfter === null) {
    return NavigationModifier.STRAIGHT;
  }
  const delta = normalizeTurnDegrees(bearingAfter - bearingBefore);
  const magnitude = Math.abs(delta);
  if (magnitude < 15) {
    return NavigationModifier.STRAIGHT;
  }
  if (magnitude >= 165) {
    return NavigationModifier.U_TURN;
  }
  if (magnitude < 45) {
    return delta < 0
      ? NavigationModifier.SLIGHT_LEFT
      : NavigationModifier.SLIGHT_RIGHT;
  }
  if (magnitude < 135) {
    return delta < 0 ? NavigationModifier.LEFT : NavigationModifier.RIGHT;
  }
  return delta < 0
    ? NavigationModifier.SHARP_LEFT
    : NavigationModifier.SHARP_RIGHT;
}

function normalizeTurnDegrees(degrees: number): number {
  return ((degrees + 540) % 360) - 180;
}

function bearingBeforeIndex(
  coordinates: readonly (readonly [number, number])[],
  index: number,
): number | null {
  for (let end = index; end > 0; end -= 1) {
    const bearing = bearingDegrees(coordinates[end - 1], coordinates[end]);
    if (bearing !== null) {
      return bearing;
    }
  }
  return null;
}

function bearingAfterIndex(
  coordinates: readonly (readonly [number, number])[],
  index: number,
): number | null {
  for (let start = index; start < coordinates.length - 1; start += 1) {
    const bearing = bearingDegrees(coordinates[start], coordinates[start + 1]);
    if (bearing !== null) {
      return bearing;
    }
  }
  return null;
}

function bearingDegrees(
  start: readonly [number, number],
  end: readonly [number, number],
): number | null {
  const [startLongitude, startLatitude] = start;
  const [endLongitude, endLatitude] = end;
  if (
    startLongitude === endLongitude &&
    startLatitude === endLatitude
  ) {
    return null;
  }
  const startLatitudeRadians = toRadians(startLatitude);
  const endLatitudeRadians = toRadians(endLatitude);
  const longitudeDelta = toRadians(endLongitude - startLongitude);
  const y = Math.sin(longitudeDelta) * Math.cos(endLatitudeRadians);
  const x =
    Math.cos(startLatitudeRadians) * Math.sin(endLatitudeRadians) -
    Math.sin(startLatitudeRadians) *
      Math.cos(endLatitudeRadians) *
      Math.cos(longitudeDelta);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return Math.round((bearing + 360) % 360) % 360;
}

function parseCoordinate(coordinate: unknown): readonly [number, number] {
  if (
    !Array.isArray(coordinate) ||
    coordinate.length !== 2 ||
    !isFiniteNumber(coordinate[0]) ||
    !isFiniteNumber(coordinate[1]) ||
    coordinate[0] < -180 ||
    coordinate[0] > 180 ||
    coordinate[1] < -90 ||
    coordinate[1] > 90
  ) {
    throw new RoutingProviderError('INVALID_RESPONSE');
  }
  return [coordinate[0], coordinate[1]];
}

function deduplicateRoutes(
  routes: readonly ProviderRoute[],
): ProviderRoute[] {
  const fingerprints = new Set<string>();
  return routes.filter((route) => {
    const fingerprint = createHash('sha256')
      .update(canonicalGeometry(route.geometry.coordinates))
      .digest('hex');
    if (fingerprints.has(fingerprint)) {
      return false;
    }
    fingerprints.add(fingerprint);
    return true;
  });
}

function canonicalGeometry(
  coordinates: readonly (readonly [number, number])[],
): string {
  return coordinates
    .map(([longitude, latitude]) => `${longitude.toFixed(6)},${latitude.toFixed(6)}`)
    .join(';');
}

function hasAcceptableEndpointSnapping(
  route: ProviderRoute,
  request: RoutingProviderRequest,
): boolean {
  const coordinates = route.geometry.coordinates;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return (
    distanceMeters(first, request.origin) <= MAX_ENDPOINT_SNAP_DISTANCE_METERS &&
    distanceMeters(last, request.destination) <= MAX_ENDPOINT_SNAP_DISTANCE_METERS
  );
}

function distanceMeters(
  coordinate: readonly [number, number],
  point: { readonly latitude: number; readonly longitude: number },
): number {
  const [longitude, latitude] = coordinate;
  const latitudeDelta = toRadians(point.latitude - latitude);
  const longitudeDelta = toRadians(point.longitude - longitude);
  const startLatitude = toRadians(latitude);
  const endLatitude = toRadians(point.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(endLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.asin(Math.min(1, Math.sqrt(haversine)))
  );
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function classifyHttpFailure(
  status: number,
  responseText: string,
): RoutingProviderError {
  const normalized = responseText.toLowerCase();
  const describesMissingRoute = [
    'connectionnotfound',
    'pointnotfound',
    'pointoutofboundsexception',
    'cannot find point',
    'cannot find path',
    'no path',
    'out of bounds',
  ].some((fragment) => normalized.includes(fragment));
  if ((status === 400 || status === 404) && describesMissingRoute) {
    return new RoutingProviderError('NO_ROUTE');
  }
  if (status >= 500) {
    return new RoutingProviderError('UNAVAILABLE');
  }
  return new RoutingProviderError('INVALID_RESPONSE');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
