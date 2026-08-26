import { join } from 'node:path';
import { readConfiguration } from './configuration';

describe('readConfiguration', () => {
  it('loads the versioned geocoding region file used by Compose', () => {
    const configuration = readConfiguration({
      GEOCODING_REGION_CONFIG: join(
        process.cwd(),
        'geocoding/region/region-config.json',
      ),
      GEOCODING_PROVIDER_TIMEOUT_MS: '2500',
    });

    expect(configuration.geocodingTimeoutMs).toBe(2_500);
    expect(configuration.geocodingRegion).toEqual({
      version: 'gathra-jakarta-tangerang-v1-2026-07-27',
      minLongitude: 106.479,
      minLatitude: -6.437,
      maxLongitude: 106.955,
      maxLatitude: -6.025,
      fallbackLatitude: -6.2202,
      fallbackLongitude: 106.7516,
    });
  });

  it('falls back safely when the region file is unavailable', () => {
    const configuration = readConfiguration({
      GEOCODING_REGION_CONFIG: '/does/not/exist.json',
    });

    expect(configuration.geocodingRegion.minLongitude).toBe(106.479);
    expect(configuration.geocodingRegion.maxLongitude).toBe(106.955);
    expect(configuration.geocodingRegion.version).toBe(
      'gathra-jakarta-tangerang-buffer-v1',
    );
  });

  it('selects Photon only through explicit provider configuration', () => {
    const photon = readConfiguration({
      GEOCODING_PROVIDER: 'photon',
      PHOTON_BASE_URL: 'http://photon:2322/',
    });

    expect(photon.geocodingProvider).toBe('photon');
    expect(photon.photonBaseUrl).toBe('http://photon:2322');
    expect(readConfiguration({}).geocodingProvider).toBe('fake');
    expect(
      readConfiguration({ GEOCODING_PROVIDER: 'unknown' }).geocodingProvider,
    ).toBe('fake');
  });

  it('keeps development flood mutation endpoints disabled by default', () => {
    expect(readConfiguration({}).enableDevFloodEndpoints).toBe(false);
    expect(
      readConfiguration({ ENABLE_DEV_FLOOD_ENDPOINTS: 'false' })
        .enableDevFloodEndpoints,
    ).toBe(false);
    expect(
      readConfiguration({ ENABLE_DEV_FLOOD_ENDPOINTS: 'true' })
        .enableDevFloodEndpoints,
    ).toBe(true);
  });

  it('selects sensor hazards by default only in production and supports explicit simulation', () => {
    expect(readConfiguration({}).floodProvider).toBe('in-memory');
    expect(readConfiguration({ NODE_ENV: 'production' }).floodProvider).toBe(
      'sensor',
    );
    expect(
      readConfiguration({ NODE_ENV: 'production', FLOOD_PROVIDER: 'in-memory' })
        .floodProvider,
    ).toBe('in-memory');
    expect(
      readConfiguration({ NODE_ENV: 'test', FLOOD_PROVIDER: 'sensor' })
        .floodProvider,
    ).toBe('sensor');
    expect(() => readConfiguration({ FLOOD_PROVIDER: 'unknown' })).toThrow(
      'FLOOD_PROVIDER must be either sensor or in-memory',
    );
  });

  it('keeps authenticated flood administration disabled by default', () => {
    const configuration = readConfiguration({});

    expect(configuration.enableFloodAdminEndpoints).toBe(false);
    expect(configuration.floodAdminTokenSha256).toBeUndefined();
  });

  it('requires a valid token digest when flood administration is enabled', () => {
    expect(() =>
      readConfiguration({ ENABLE_FLOOD_ADMIN_ENDPOINTS: 'true' }),
    ).toThrow(
      'FLOOD_ADMIN_TOKEN_SHA256 is required when ENABLE_FLOOD_ADMIN_ENDPOINTS=true',
    );
    expect(() =>
      readConfiguration({
        ENABLE_FLOOD_ADMIN_ENDPOINTS: 'true',
        FLOOD_ADMIN_TOKEN_SHA256: 'not-a-digest',
      }),
    ).toThrow(
      'FLOOD_ADMIN_TOKEN_SHA256 must be a 64-character hexadecimal SHA-256 digest',
    );
  });

  it('normalizes a configured flood administration token digest', () => {
    const configuration = readConfiguration({
      ENABLE_FLOOD_ADMIN_ENDPOINTS: 'TRUE',
      FLOOD_ADMIN_TOKEN_SHA256: ` ${'AB'.repeat(32)} `,
    });

    expect(configuration.enableFloodAdminEndpoints).toBe(true);
    expect(configuration.floodAdminTokenSha256).toBe('ab'.repeat(32));
  });

  it('parses configured flood validation limits', () => {
    const configuration = readConfiguration({
      MAX_ACTIVE_FLOOD_HAZARDS: '7',
      MAX_FLOOD_POLYGON_VERTICES: '123',
    });

    expect(configuration.maxActiveFloodHazards).toBe(7);
    expect(configuration.maxFloodPolygonVertices).toBe(123);
  });

  it('validates IoT database, token digest, and API limits', () => {
    const configuration = readConfiguration({
      DATABASE_URL: 'postgresql://user:pass@postgres:5432/gathra',
      IOT_GATEWAY_TOKEN_SHA256: ` ${'AB'.repeat(32)} `,
      IOT_MAX_BATCH_SIZE: '20',
      IOT_MONITOR_MAX_LIMIT: '500',
      IOT_MONITOR_ALLOWED_ORIGINS:
        'https://gathra.my.id/, http://localhost:5173, https://gathra.my.id',
    });

    expect(configuration.databaseUrl).toBe(
      'postgresql://user:pass@postgres:5432/gathra',
    );
    expect(configuration.iotGatewayTokenSha256).toBe('ab'.repeat(32));
    expect(configuration.iotMaxBatchSize).toBe(20);
    expect(configuration.iotMonitorMaxLimit).toBe(500);
    expect(configuration.iotMonitorAllowedOrigins).toEqual([
      'https://gathra.my.id',
      'http://localhost:5173',
    ]);
  });

  it('rejects malformed IoT security and persistence configuration', () => {
    expect(() =>
      readConfiguration({ IOT_GATEWAY_TOKEN_SHA256: 'not-a-digest' }),
    ).toThrow(
      'IOT_GATEWAY_TOKEN_SHA256 must be a 64-character hexadecimal SHA-256 digest',
    );
    expect(() =>
      readConfiguration({ DATABASE_URL: 'sqlite:///tmp/db' }),
    ).toThrow('DATABASE_URL must be a valid PostgreSQL connection URL');
    expect(() => readConfiguration({ IOT_MAX_BATCH_SIZE: '51' })).toThrow(
      'IOT_MAX_BATCH_SIZE must be an integer from 1 to 50',
    );
    expect(() =>
      readConfiguration({
        IOT_MONITOR_ALLOWED_ORIGINS: 'https://gathra.my.id/node',
      }),
    ).toThrow(
      'IOT_MONITOR_ALLOWED_ORIGINS must contain only absolute HTTP(S) origins',
    );
  });

  it('allows the production monitoring website origin by default', () => {
    expect(readConfiguration({}).iotMonitorAllowedOrigins).toEqual([
      'https://gathra.my.id',
    ]);
  });
});
