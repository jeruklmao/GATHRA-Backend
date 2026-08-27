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
const DEFAULT_DATABASE_URL =
  'postgresql://gathra:gathra-local-only@127.0.0.1:5432/gathra';
const DEFAULT_IOT_MAX_BATCH_SIZE = 50;
const DEFAULT_IOT_MONITOR_MAX_LIMIT = 1_000;
const DEFAULT_IOT_MONITOR_ALLOWED_ORIGINS = ['https://gathra.my.id'];

export interface AppConfiguration {
  readonly port: number;
  readonly databaseUrl: string;
  readonly iotGatewayTokenSha256?: string;
  readonly iotMaxBatchSize: number;
  readonly iotMonitorMaxLimit: number;
  readonly iotMonitorAllowedOrigins: readonly string[];
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
  readonly floodProvider: 'in-memory' | 'sensor';
  readonly enableDevFloodEndpoints: boolean;
  readonly enableFloodAdminEndpoints: boolean;
  readonly floodAdminTokenSha256?: string;
  readonly maxActiveFloodHazards: number;
  readonly maxFloodPolygonVertices: number;
  readonly adminDashboardEnabled: boolean;
  readonly adminAuthFile: string;
  readonly adminObserverDirectory: string;
  readonly adminSessionIdleMinutes: number;
  readonly adminSessionAbsoluteMinutes: number;
  readonly adminMetricsRetentionDays: number;
}

export function readConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfiguration {
  const floodAdmin = readFloodAdminConfiguration(environment);
  const iot = readIotConfiguration(environment);
  return {
    port: parsePositiveInteger(environment.PORT, DEFAULT_PORT),
    ...iot,
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
    floodProvider: readFloodProvider(environment),
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
    ...readDashboardConfiguration(environment),
  };
}

function readDashboardConfiguration(environment: NodeJS.ProcessEnv): {
  readonly adminDashboardEnabled: boolean;
  readonly adminAuthFile: string;
  readonly adminObserverDirectory: string;
  readonly adminSessionIdleMinutes: number;
  readonly adminSessionAbsoluteMinutes: number;
  readonly adminMetricsRetentionDays: number;
} {
  const adminSessionIdleMinutes = parseBoundedIntegerStrict(
    environment.ADMIN_SESSION_IDLE_MINUTES,
    30,
    5,
    1_440,
    'ADMIN_SESSION_IDLE_MINUTES',
  );
  const adminSessionAbsoluteMinutes = parseBoundedIntegerStrict(
    environment.ADMIN_SESSION_ABSOLUTE_MINUTES,
    720,
    30,
    10_080,
    'ADMIN_SESSION_ABSOLUTE_MINUTES',
  );
  if (adminSessionAbsoluteMinutes < adminSessionIdleMinutes) {
    throw new Error(
      'ADMIN_SESSION_ABSOLUTE_MINUTES must be at least ADMIN_SESSION_IDLE_MINUTES',
    );
  }
  return {
    adminDashboardEnabled:
      environment.ADMIN_DASHBOARD_ENABLED?.toLowerCase() === 'true',
    adminAuthFile:
      environment.ADMIN_AUTH_FILE?.trim() ||
      '/run/secrets/gathra-admin-auth.env',
    adminObserverDirectory:
      environment.ADMIN_OBSERVER_DIRECTORY?.trim() ||
      '/run/gathra-admin-observer',
    adminSessionIdleMinutes,
    adminSessionAbsoluteMinutes,
    adminMetricsRetentionDays: parseBoundedIntegerStrict(
      environment.ADMIN_METRICS_RETENTION_DAYS,
      30,
      7,
      90,
      'ADMIN_METRICS_RETENTION_DAYS',
    ),
  };
}

function readFloodProvider(
  environment: NodeJS.ProcessEnv,
): AppConfiguration['floodProvider'] {
  const configured = environment.FLOOD_PROVIDER?.trim().toLowerCase();
  if (configured === undefined || configured === '') {
    return environment.NODE_ENV === 'production' ? 'sensor' : 'in-memory';
  }
  if (configured !== 'sensor' && configured !== 'in-memory') {
    throw new Error('FLOOD_PROVIDER must be either sensor or in-memory');
  }
  return configured;
}

function readIotConfiguration(environment: NodeJS.ProcessEnv): {
  readonly databaseUrl: string;
  readonly iotGatewayTokenSha256?: string;
  readonly iotMaxBatchSize: number;
  readonly iotMonitorMaxLimit: number;
  readonly iotMonitorAllowedOrigins: readonly string[];
} {
  const databaseUrl = environment.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }
  if (
    (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') ||
    parsed.hostname === '' ||
    parsed.pathname.length <= 1
  ) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }
  const configuredDigest =
    environment.IOT_GATEWAY_TOKEN_SHA256?.trim().toLowerCase() || undefined;
  if (
    configuredDigest !== undefined &&
    !/^[a-f0-9]{64}$/.test(configuredDigest)
  ) {
    throw new Error(
      'IOT_GATEWAY_TOKEN_SHA256 must be a 64-character hexadecimal SHA-256 digest',
    );
  }
  return {
    databaseUrl,
    ...(configuredDigest === undefined
      ? {}
      : { iotGatewayTokenSha256: configuredDigest }),
    iotMaxBatchSize: parseBoundedIntegerStrict(
      environment.IOT_MAX_BATCH_SIZE,
      DEFAULT_IOT_MAX_BATCH_SIZE,
      1,
      50,
      'IOT_MAX_BATCH_SIZE',
    ),
    iotMonitorMaxLimit: parseBoundedIntegerStrict(
      environment.IOT_MONITOR_MAX_LIMIT,
      DEFAULT_IOT_MONITOR_MAX_LIMIT,
      1,
      1_000,
      'IOT_MONITOR_MAX_LIMIT',
    ),
    iotMonitorAllowedOrigins: parseHttpOrigins(
      environment.IOT_MONITOR_ALLOWED_ORIGINS,
    ),
  };
}

function parseHttpOrigins(rawValue: string | undefined): readonly string[] {
  const candidates =
    rawValue === undefined || rawValue.trim() === ''
      ? DEFAULT_IOT_MONITOR_ALLOWED_ORIGINS
      : rawValue.split(',').map((value) => value.trim());
  if (candidates.length === 0 || candidates.length > 16) {
    throw new Error(
      'IOT_MONITOR_ALLOWED_ORIGINS must contain from 1 to 16 HTTP(S) origins',
    );
  }
  const normalized = candidates.map((candidate) => {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error(
        'IOT_MONITOR_ALLOWED_ORIGINS must contain only absolute HTTP(S) origins',
      );
    }
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      parsed.origin === 'null'
    ) {
      throw new Error(
        'IOT_MONITOR_ALLOWED_ORIGINS must contain only absolute HTTP(S) origins',
      );
    }
    return parsed.origin;
  });
  return [...new Set(normalized)];
}

function parseBoundedIntegerStrict(
  rawValue: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (rawValue === undefined || rawValue.trim() === '') return fallback;
  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
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
