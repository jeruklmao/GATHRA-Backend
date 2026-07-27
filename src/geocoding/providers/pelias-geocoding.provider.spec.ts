import { GeocodingProviderError } from '../geocoding-provider';
import { SupportedRegion } from '../region/supported-region';
import { PeliasGeocodingProvider } from './pelias-geocoding.provider';

describe('PeliasGeocodingProvider', () => {
  const originalFetch = global.fetch;
  let provider: PeliasGeocodingProvider;

  beforeEach(() => {
    provider = new PeliasGeocodingProvider(new SupportedRegion());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends country, buffered bounds, language, proximity and limit', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(
        featureCollection([
          feature('openstreetmap:venue:node/1', 'Sekolah Uji'),
        ]),
      ),
    );
    global.fetch = fetchMock;

    const results = await provider.autocomplete({
      query: 'Sekolah Uji',
      proximity: { latitude: -6.2, longitude: 106.8 },
      limit: 6,
      language: 'id',
    });

    expect(results).toHaveLength(1);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.pathname).toBe('/v1/autocomplete');
    expect(url.searchParams.get('text')).toBe('Sekolah Uji');
    expect(url.searchParams.get('size')).toBe('6');
    expect(url.searchParams.get('lang')).toBe('id');
    expect(url.searchParams.get('boundary.country')).toBe('IDN');
    expect(url.searchParams.get('boundary.rect.min_lon')).toBe('106.479');
    expect(url.searchParams.get('boundary.rect.max_lon')).toBe('106.955');
    expect(url.searchParams.get('focus.point.lat')).toBe('-6.2');
  });

  it('preserves an exact reverse-geocoding point', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(
        featureCollection([
          feature('openstreetmap:street:way/1', 'Jalan Uji'),
        ]),
      ),
    );
    const point = { latitude: -6.201234, longitude: 106.801234 };

    const result = await provider.reverse({ point, language: 'id' });

    expect(result?.position).toEqual(point);
  });

  it('maps aborts to a provider timeout', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abort);

    await expect(
      provider.search({
        query: 'Jakarta',
        proximity: { latitude: -6.2, longitude: 106.8 },
        limit: 8,
        language: 'id',
      }),
    ).rejects.toEqual(new GeocodingProviderError('TIMEOUT'));
  });

  it('rejects malformed provider JSON and oversized declarations', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response('not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 200,
          headers: { 'content-length': String(3 * 1024 * 1024) },
        }),
      );

    await expect(
      provider.search(searchInput()),
    ).rejects.toEqual(new GeocodingProviderError('INVALID_RESPONSE'));
    await expect(
      provider.search(searchInput()),
    ).rejects.toEqual(new GeocodingProviderError('INVALID_RESPONSE'));
  });

  it('maps service failures without exposing provider response bodies', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('sensitive elasticsearch details', { status: 503 }),
    );

    await expect(provider.search(searchInput())).rejects.toEqual(
      new GeocodingProviderError('UNAVAILABLE'),
    );
  });
});

function searchInput() {
  return {
    query: 'Jakarta',
    proximity: { latitude: -6.2, longitude: 106.8 },
    limit: 8,
    language: 'id',
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function featureCollection(features: unknown[]) {
  return { type: 'FeatureCollection', features };
}

function feature(gid: string, name: string) {
  return {
    type: 'Feature',
    properties: {
      gid,
      name,
      label: `${name}, Jakarta, Indonesia`,
      layer: 'venue',
    },
    geometry: {
      type: 'Point',
      coordinates: [106.825, -6.1939],
    },
  };
}
