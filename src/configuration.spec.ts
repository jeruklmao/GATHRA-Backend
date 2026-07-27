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
});
