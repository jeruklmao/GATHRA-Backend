import { GeocodingProviderError } from '../geocoding-provider';
import { SupportedRegion } from '../region/supported-region';
import { PhotonGeocodingProvider } from './photon-geocoding.provider';

describe('PhotonGeocodingProvider', () => {
  const originalFetch = global.fetch;
  let provider: PhotonGeocodingProvider;

  beforeEach(() => {
    provider = new PhotonGeocodingProvider(new SupportedRegion());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends buffered bounds, language, proximity and limit', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(
        featureCollection([feature(1, 'Sekolah Uji')]),
      ),
    );
    global.fetch = fetchMock;

    const results = await provider.autocomplete({
      query: 'Sekolah Uji',
      proximity: { latitude: -6.2, longitude: 106.8 },
      limit: 6,
      language: 'id-ID',
    });

    expect(results).toHaveLength(1);
    expect(results[0].distanceMeters).toBeGreaterThan(0);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.pathname).toBe('/api');
    expect(url.searchParams.get('q')).toBe('Sekolah Uji');
    expect(url.searchParams.get('limit')).toBe('6');
    expect(url.searchParams.has('lang')).toBe(false);
    expect(url.searchParams.has('countrycode')).toBe(false);
    expect(url.searchParams.get('bbox')).toBe(
      '106.479,-6.437,106.955,-6.025',
    );
    expect(url.searchParams.get('lat')).toBe('-6.2');
    expect(url.searchParams.get('lon')).toBe('106.8');
  });

  it('preserves an exact reverse-geocoding point', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(
        featureCollection([feature(2, 'Jalan Uji')]),
      ),
    );
    const point = { latitude: -6.201234, longitude: 106.801234 };

    const result = await provider.reverse({ point, language: 'id' });

    expect(result?.position).toEqual(point);
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as URL;
    expect(url.pathname).toBe('/reverse');
    expect(url.searchParams.get('lat')).toBe(String(point.latitude));
    expect(url.searchParams.get('lon')).toBe(String(point.longitude));
    expect(url.searchParams.has('lang')).toBe(false);
  });

  it('uses only Photon 0.5-compatible health parameters', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(featureCollection([feature(3, 'Jakarta')])),
    );
    global.fetch = fetchMock;

    await provider.health();

    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.pathname).toBe('/api');
    expect(url.searchParams.get('bbox')).toBe(
      '106.479,-6.437,106.955,-6.025',
    );
    expect(url.searchParams.has('countrycode')).toBe(false);
    expect(url.searchParams.has('lang')).toBe(false);
  });

  it('uses the service lookup cache instead of inventing an unsupported provider endpoint', async () => {
    await expect(provider.lookup('N:123')).rejects.toEqual(
      new GeocodingProviderError('NOT_FOUND'),
    );
    expect(global.fetch).toBe(originalFetch);
  });

  it('maps aborts to a provider timeout', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abort);

    await expect(provider.search(searchInput())).rejects.toEqual(
      new GeocodingProviderError('TIMEOUT'),
    );
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

    await expect(provider.search(searchInput())).rejects.toEqual(
      new GeocodingProviderError('INVALID_RESPONSE'),
    );
    await expect(provider.search(searchInput())).rejects.toEqual(
      new GeocodingProviderError('INVALID_RESPONSE'),
    );
  });

  it('maps service failures without exposing provider response bodies', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('sensitive internal index details', { status: 503 }),
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

function feature(osmId: number, name: string) {
  return {
    type: 'Feature',
    properties: {
      osm_type: 'N',
      osm_id: osmId,
      osm_key: 'amenity',
      osm_value: 'school',
      name,
      city: 'Jakarta',
      country: 'Indonesia',
    },
    geometry: {
      type: 'Point',
      coordinates: [106.825, -6.1939],
    },
  };
}
