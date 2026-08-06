import { readFileSync } from 'node:fs';

const DEFAULT_PORT = 3000;
const DEFAULT_ROUTING_ENGINE_URL = 'http://routing-engine:8989';
const DEFAULT_ROUTING_TIMEOUT_MS = 8_000;
const DEFAULT_PHOTON_URL = 'http://photon:2322';
const DEFAULT_GEOCODING_TIMEOUT_MS = 3_500;
const DEFAULT_GEOCODING_CONCURRENCY = 8;
const DEFAULT_GEOCODING_QUEUE_SIZE = 32;
const DEFAULT_GEOCODING_RATE_LIMIT = 60;
const DEFAULT_GEOCODING_RATE_WINDOW_MS = 60_000;
const DEFAULT_GEOCODING_CACHE_ENTRIES = 1_000;
const DEFAULT_GEOCODING_CACHE_TTL_MS = 60_000;
const DEFAULT_GEOCODING_REVERSE_CACHE_TTL_MS = 300_000;
const DEFAULT_REGION_VERSION = 'gathra-jakarta-tangerang-buffer-v1';

export interface AppConfiguration {
  readonly port: number;
  readonly routingEngineBaseUrl: string;
  readonly routingEngineTimeoutMs: number;
  readonly geocodingProvider: 'fake' | 'photon';
  readonly photonBaseUrl: string;
  readonly geocodingTimeoutMs: number;
  readonly geocodingMaxConcurrency: number;
  readonly geocodingMaxQueueSize: number;
  readonly geocodingRateLimit: number;
  readonly geocodingRateWindowMs: number;
  readonly geocodingCacheEntries: number;
  readonly geocodingCacheTtlMs: number;
  readonly geocodingReverseCacheTtlMs: number;
  readonly geocodingTokenSecret?: string;
  readonly geocodingRegion: {
    readonly version: string;
    readonly minLongitude: number;
    readonly minLatitude: number;
    readonly maxLongitude: number;
    readonly maxLatitude: number;
    readonly fallbackLatitude: number;
    readonly fallbackLongitude: number;
  };
  readonly floodProvider: 'in-memory';
  readonly enableDevFloodEndpoints: boolean;
  readonly enableFloodAdminEndpoints: boolean;
  readonly floodAdminTokenSha256?: string;
  readonly maxActiveFloodHazards: number;
  readonly maxFloodPolygonVertices: number;
}

export function readConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfiguration {
  const floodAdmin = readFloodAdminConfiguration(environment);
  return {
    port: parsePositiveInteger(environment.PORT, DEFAULT_PORT),
    routingEngineBaseUrl: normalizeBaseUrl(
      environment.ROUTING_ENGINE_BASE_URL ?? DEFAULT_ROUTING_ENGINE_URL,
    ),
    routingEngineTimeoutMs: parsePositiveInteger(
      environment.ROUTING_ENGINE_TIMEOUT_MS,
      DEFAULT_ROUTING_TIMEOUT_MS,
    ),
    geocodingProvider:
      environment.GEOCODING_PROVIDER?.toLowerCase() === 'photon'
        ? 'photon'
        : 'fake',
    photonBaseUrl: normalizeBaseUrl(
      environment.PHOTON_BASE_URL ?? DEFAULT_PHOTON_URL,
    ),
    geocodingTimeoutMs: parsePositiveInteger(
      environment.GEOCODING_PROVIDER_TIMEOUT_MS ??
        environment.GEOCODING_TIMEOUT_MS,
      DEFAULT_GEOCODING_TIMEOUT_MS,
    ),
    geocodingMaxConcurrency: parsePositiveInteger(
      environment.GEOCODING_MAX_CONCURRENCY,
      DEFAULT_GEOCODING_CONCURRENCY,
    ),
    geocodingMaxQueueSize: parseNonNegativeInteger(
      environment.GEOCODING_MAX_QUEUE_SIZE,
      DEFAULT_GEOCODING_QUEUE_SIZE,
    ),
    geocodingRateLimit: parsePositiveInteger(
      environment.GEOCODING_RATE_LIMIT,
      DEFAULT_GEOCODING_RATE_LIMIT,
    ),
    geocodingRateWindowMs: parsePositiveInteger(
      environment.GEOCODING_RATE_WINDOW_MS,
      DEFAULT_GEOCODING_RATE_WINDOW_MS,
    ),
    geocodingCacheEntries: parsePositiveInteger(
      environment.GEOCODING_CACHE_ENTRIES,
      DEFAULT_GEOCODING_CACHE_ENTRIES,
    ),
    geocodingCacheTtlMs: parsePositiveInteger(
      environment.GEOCODING_CACHE_TTL_MS,
      DEFAULT_GEOCODING_CACHE_TTL_MS,
    ),
    geocodingReverseCacheTtlMs: parsePositiveInteger(
      environment.GEOCODING_REVERSE_CACHE_TTL_MS,
      DEFAULT_GEOCODING_REVERSE_CACHE_TTL_MS,
    ),
    geocodingTokenSecret:
      environment.GEOCODING_TOKEN_SECRET?.trim() || undefined,
    geocodingRegion: readGeocodingRegion(environment),
    floodProvider: 'in-memory',
    enableDevFloodEndpoints:
      environment.ENABLE_DEV_FLOOD_ENDPOINTS?.toLowerCase() === 'true',
    ...floodAdmin,
    maxActiveFloodHazards: parsePositiveInteger(
      environment.MAX_ACTIVE_FLOOD_HAZARDS,
      50,
    ),
    maxFloodPolygonVertices: parsePositiveInteger(
      environment.MAX_FLOOD_POLYGON_VERTICES,
      2000,
    ),
  };
}

function readFloodAdminConfiguration(environment: NodeJS.ProcessEnv): {
  readonly enableFloodAdminEndpoints: boolean;
  readonly floodAdminTokenSha256?: string;
} {
  const enableFloodAdminEndpoints =
    environment.ENABLE_FLOOD_ADMIN_ENDPOINTS?.toLowerCase() === 'true';
  const configuredDigest =
    environment.FLOOD_ADMIN_TOKEN_SHA256?.trim().toLowerCase() || undefined;

  if (
    configuredDigest !== undefined &&
    !/^[a-f0-9]{64}$/.test(configuredDigest)
  ) {
    throw new Error(
      'FLOOD_ADMIN_TOKEN_SHA256 must be a 64-character hexadecimal SHA-256 digest',
    );
  }
  if (enableFloodAdminEndpoints && configuredDigest === undefined) {
    throw new Error(
      'FLOOD_ADMIN_TOKEN_SHA256 is required when ENABLE_FLOOD_ADMIN_ENDPOINTS=true',
    );
  }

  return {
    enableFloodAdminEndpoints,
    ...(configuredDigest === undefined
      ? {}
      : { floodAdminTokenSha256: configuredDigest }),
  };
}

function parsePositiveInteger(
  rawValue: string | undefined,
  fallback: number,
): number {
  if (rawValue === undefined) {
    return fallback;
  }
  const parsed = Number(rawValue);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function parseNonNegativeInteger(
  rawValue: string | undefined,
  fallback: number,
): number {
  if (rawValue === undefined) {
    return fallback;
  }
  const parsed = Number(rawValue);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function readGeocodingRegion(
  environment: NodeJS.ProcessEnv,
): AppConfiguration['geocodingRegion'] {
  const fileRegion = readRegionFile(environment.GEOCODING_REGION_CONFIG);
  const minLongitude = parseFiniteNumber(
    environment.GEOCODING_REGION_MIN_LONGITUDE,
    fileRegion?.minLongitude ?? 106.479,
  );
  const minLatitude = parseFiniteNumber(
    environment.GEOCODING_REGION_MIN_LATITUDE,
    fileRegion?.minLatitude ?? -6.437,
  );
  const maxLongitude = parseFiniteNumber(
    environment.GEOCODING_REGION_MAX_LONGITUDE,
    fileRegion?.maxLongitude ?? 106.955,
  );
  const maxLatitude = parseFiniteNumber(
    environment.GEOCODING_REGION_MAX_LATITUDE,
    fileRegion?.maxLatitude ?? -6.025,
  );

  if (
    minLongitude >= maxLongitude ||
    minLatitude >= maxLatitude ||
    minLongitude < -180 ||
    maxLongitude > 180 ||
    minLatitude < -90 ||
    maxLatitude > 90
  ) {
    return {
      version: DEFAULT_REGION_VERSION,
      minLongitude: 106.479,
      minLatitude: -6.437,
      maxLongitude: 106.955,
      maxLatitude: -6.025,
      fallbackLatitude: -6.2202,
      fallbackLongitude: 106.7516,
    };
  }

  return {
    version:
      environment.GEOCODING_REGION_VERSION?.trim() ||
      fileRegion?.version ||
      DEFAULT_REGION_VERSION,
    minLongitude,
    minLatitude,
    maxLongitude,
    maxLatitude,
    fallbackLatitude: fileRegion?.fallbackLatitude ?? -6.2202,
    fallbackLongitude: fileRegion?.fallbackLongitude ?? 106.7516,
  };
}

function parseFiniteNumber(
  rawValue: string | undefined,
  fallback: number,
): number {
  if (rawValue === undefined || rawValue.trim() === '') {
    return fallback;
  }
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readRegionFile(path: string | undefined): {
  readonly version: string;
  readonly minLongitude: number;
  readonly minLatitude: number;
  readonly maxLongitude: number;
  readonly maxLatitude: number;
  readonly fallbackLatitude: number;
  readonly fallbackLongitude: number;
} | null {
  if (path === undefined || path.trim() === '') {
    return null;
  }
  try {
    const payload = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!isRecord(payload)) {
      return null;
    }
    const bounds = isRecord(payload.bufferedBoundingBox)
      ? payload.bufferedBoundingBox
      : isRecord(payload.bounds)
        ? {
            minLongitude: payload.bounds.west,
            minLatitude: payload.bounds.south,
            maxLongitude: payload.bounds.east,
            maxLatitude: payload.bounds.north,
          }
        : null;
    const focus = isRecord(payload.fallbackFocus)
      ? payload.fallbackFocus
      : null;
    const version =
      typeof payload.regionConfigVersion === 'string'
        ? payload.regionConfigVersion
        : typeof payload.version === 'string'
          ? payload.version
          : null;
    if (
      bounds === null ||
      focus === null ||
      version === null ||
      !areFiniteNumbers(
        bounds.minLongitude,
        bounds.minLatitude,
        bounds.maxLongitude,
        bounds.maxLatitude,
        focus.latitude,
        focus.longitude,
      )
    ) {
      return null;
    }
    return {
      version,
      minLongitude: bounds.minLongitude as number,
      minLatitude: bounds.minLatitude as number,
      maxLongitude: bounds.maxLongitude as number,
      maxLatitude: bounds.maxLatitude as number,
      fallbackLatitude: focus.latitude as number,
      fallbackLongitude: focus.longitude as number,
    };
  } catch {
    return null;
  }
}

function areFiniteNumbers(...values: unknown[]): boolean {
  return values.every(
    (value) => typeof value === 'number' && Number.isFinite(value),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
