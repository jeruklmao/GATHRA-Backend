import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app-bootstrap';
import {
  GEOCODING_PROVIDER,
  type GeocodingProvider,
  GeocodingProviderError,
} from '../src/geocoding/geocoding-provider';
import {
  GeocodingSource,
  PlaceCategory,
} from '../src/geocoding/models/geocoding.models';
import {
  ROUTING_PROVIDER,
  type RoutingProvider,
} from '../src/routes/routing-provider';

describe('geocoding API (integration)', () => {
  let app: INestApplication;
  let geocodingProvider: jest.Mocked<GeocodingProvider>;

  beforeEach(async () => {
    geocodingProvider = providerStub();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GEOCODING_PROVIDER)
      .useValue(geocodingProvider)
      .overrideProvider(ROUTING_PROVIDER)
      .useValue(routingProviderStub())
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ['autocomplete', 6],
    ['search', 8],
  ])('serves normalized %s results with location bias', async (path, limit) => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/geocoding/${path}`)
      .set('x-request-id', `geocoding-${path}`)
      .query({
        q: '  SMA   Negeri 35  ',
        lat: '-6.1939',
        lon: '106.825',
        language: 'id',
        forField: 'DESTINATION',
      })
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('x-request-id', `geocoding-${path}`);

    expect(response.body).toMatchObject({
      requestId: `geocoding-${path}`,
      suggestions: [
        {
          primaryText: 'SMA Negeri 35 Jakarta',
          secondaryText: 'Tanah Abang, Jakarta Pusat',
          category: 'SCHOOL',
          position: { latitude: -6.1939, longitude: 106.825 },
          distanceMeters: 1_600,
          insideSupportedRegion: true,
        },
        {
          primaryText: 'Lokasi Uji Bekasi',
          insideSupportedRegion: false,
        },
      ],
    });
    expect(response.body.suggestions[0].id).toMatch(/^v1\./);
    expect(JSON.stringify(response.body)).not.toContain('providerId');

    const method =
      path === 'autocomplete'
        ? geocodingProvider.autocomplete
        : geocodingProvider.search;
    expect(method).toHaveBeenCalledWith({
      query: 'SMA Negeri 35',
      proximity: { latitude: -6.1939, longitude: 106.825 },
      limit,
      language: 'id',
    });
  });

  it('enforces explicit limits and rejects malformed query input', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/geocoding/search')
      .query({ q: 'Jakarta', limit: '3' })
      .expect(200);
    expect(geocodingProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 3 }),
    );

    for (const query of [
      { q: ' ' },
      { q: 'x' },
      { q: 'x'.repeat(121) },
      { q: 'Jakarta', limit: '9' },
      { q: 'Jakarta', limit: '1.5' },
      { q: 'Jakarta', lat: '-6.2' },
      { q: 'Jakarta', lat: '-91', lon: '106.8' },
      { q: 'Jakarta', forField: 'UNKNOWN' },
    ]) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/geocoding/search')
        .query(query)
        .expect(400);
      expect(response.body.error.retryable).toBe(false);
      expect(['INVALID_QUERY', 'INVALID_COORDINATES']).toContain(
        response.body.error.code,
      );
    }
  });

  it('uses a fallback focus and does not pass unknown query fields', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/geocoding/autocomplete')
      .query({ q: 'Jakarta' })
      .expect(200);

    expect(geocodingProvider.autocomplete).toHaveBeenCalledWith(
      expect.objectContaining({
        proximity: { latitude: -6.2202, longitude: 106.7516 },
      }),
    );

    const response = await request(app.getHttpServer())
      .get('/api/v1/geocoding/autocomplete')
      .query({ q: 'Jakarta', internal: 'secret' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('looks up a signed token and rejects tampered tokens', async () => {
    const searchResponse = await request(app.getHttpServer())
      .get('/api/v1/geocoding/search')
      .query({ q: 'Sekolah' })
      .expect(200);
    const token = searchResponse.body.suggestions[0].id as string;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/geocoding/places/${encodeURIComponent(token)}`)
      .expect(200);
    expect(response.body).toEqual({
      id: token,
      name: 'SMA Negeri 35 Jakarta',
      formattedAddress: 'Tanah Abang, Jakarta Pusat',
      position: { latitude: -6.1939, longitude: 106.825 },
      category: 'SCHOOL',
      insideSupportedRegion: true,
    });
    expect(geocodingProvider.lookup).toHaveBeenCalledWith(
      'fake:venue:sman-35',
    );

    await request(app.getHttpServer())
      .get(
        `/api/v1/geocoding/places/${encodeURIComponent(`${token.slice(0, -1)}x`)}`,
      )
      .expect(404)
      .expect(({ body }) => {
        expect(body.error.code).toBe('PLACE_NOT_FOUND');
      });
  });

  it('preserves exact reverse coordinates and returns 204 for no label', async () => {
    geocodingProvider.reverse.mockResolvedValueOnce({
      providerId: 'fake:street:nearby',
      name: 'Jalan Terdekat',
      formattedAddress: 'Jakarta Selatan',
      position: { latitude: 0, longitude: 0 },
      category: PlaceCategory.ROAD,
      source: GeocodingSource.GATHRA_CSV,
    });
    const response = await request(app.getHttpServer())
      .get('/api/v1/geocoding/reverse')
      .query({ lat: '-6.201234', lon: '106.801234' })
      .expect(200);
    expect(response.body.position).toEqual({
      latitude: -6.201234,
      longitude: 106.801234,
    });

    const cachedResponse = await request(app.getHttpServer())
      .get('/api/v1/geocoding/reverse')
      .query({ lat: '-6.2012339', lon: '106.8012341' })
      .expect(200);
    expect(cachedResponse.body.position).toEqual({
      latitude: -6.2012339,
      longitude: 106.8012341,
    });
    expect(geocodingProvider.reverse).toHaveBeenCalledTimes(1);

    geocodingProvider.reverse.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .get('/api/v1/geocoding/reverse')
      .query({ lat: '-6.3', lon: '106.7' })
      .expect(204);
  });

  it('rejects invalid or outside reverse coordinates before provider access', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/geocoding/reverse')
      .query({ lat: 'NaN', lon: '106.8' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.error.code).toBe('INVALID_COORDINATES');
      });

    await request(app.getHttpServer())
      .get('/api/v1/geocoding/reverse')
      .query({ lat: '-6.2', lon: '107.1' })
      .expect(422)
      .expect(({ body }) => {
        expect(body.error.code).toBe('OUTSIDE_SUPPORTED_REGION');
      });
    expect(geocodingProvider.reverse).not.toHaveBeenCalled();
  });

  it.each([
    ['TIMEOUT', 504, 'GEOCODER_TIMEOUT'],
    ['UNAVAILABLE', 503, 'GEOCODER_UNAVAILABLE'],
    ['INVALID_RESPONSE', 502, 'INVALID_PROVIDER_RESPONSE'],
  ] as const)(
    'maps %s failures into sanitized common envelopes',
    async (kind, status, code) => {
      geocodingProvider.search.mockRejectedValueOnce(
        new GeocodingProviderError(kind, {
          cause: new Error('sensitive Pelias or Elasticsearch details'),
        }),
      );
      const response = await request(app.getHttpServer())
        .get('/api/v1/geocoding/search')
        .query({ q: 'Jakarta' })
        .expect(status);

      expect(response.body.error).toMatchObject({ code, retryable: true });
      expect(JSON.stringify(response.body)).not.toContain('Pelias');
      expect(JSON.stringify(response.body)).not.toContain('Elasticsearch');
    },
  );

  it('reports both providers in health and publishes all OpenAPI paths', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200, {
        status: 'ok',
        service: 'gathra-routing-api',
        checks: { routing: 'up', geocoding: 'up' },
      });

    const docs = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(docs.body.paths).toHaveProperty(
      '/api/v1/geocoding/autocomplete',
    );
    expect(docs.body.paths).toHaveProperty('/api/v1/geocoding/search');
    expect(docs.body.paths).toHaveProperty('/api/v1/geocoding/places/{id}');
    expect(docs.body.paths).toHaveProperty('/api/v1/geocoding/reverse');
  });

  it('makes a Pelias health failure visible without hiding routing readiness', async () => {
    geocodingProvider.health.mockRejectedValueOnce(new Error('offline'));

    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503, {
        status: 'unavailable',
        service: 'gathra-routing-api',
        checks: { routing: 'up', geocoding: 'down' },
      });
  });

  it('rate limits a noisy client using the common envelope', async () => {
    for (let index = 0; index < 60; index += 1) {
      await request(app.getHttpServer())
        .get('/api/v1/geocoding/search')
        .query({ q: `Jakarta ${index}` })
        .expect(200);
    }
    await request(app.getHttpServer())
      .get('/api/v1/geocoding/search')
      .query({ q: 'one request too many' })
      .expect(429)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({
          code: 'GEOCODING_RATE_LIMITED',
          retryable: true,
        });
      });
  });
});

describe('geocoding API fake-provider mode (integration)', () => {
  let app: INestApplication;
  const previousProvider = process.env.GEOCODING_PROVIDER;

  beforeAll(async () => {
    process.env.GEOCODING_PROVIDER = 'fake';
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ROUTING_PROVIDER)
      .useValue(routingProviderStub())
      .compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (previousProvider === undefined) {
      delete process.env.GEOCODING_PROVIDER;
    } else {
      process.env.GEOCODING_PROVIDER = previousProvider;
    }
  });

  it('serves deterministic typo-tolerant fixtures without Pelias', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/geocoding/search')
      .query({
        q: 'Tanggerang',
        lat: '-6.18',
        lon: '106.63',
      })
      .expect(200);

    expect(response.body.suggestions.length).toBeGreaterThan(0);
    expect(
      response.body.suggestions.some((suggestion: { primaryText: string }) =>
        suggestion.primaryText.includes('Tangerang'),
      ),
    ).toBe(true);
  });
});

function providerStub(): jest.Mocked<GeocodingProvider> {
  const suggestion = {
    providerId: 'fake:venue:sman-35',
    primaryText: 'SMA Negeri 35 Jakarta',
    secondaryText: 'Tanah Abang, Jakarta Pusat',
    category: PlaceCategory.SCHOOL,
    position: { latitude: -6.1939, longitude: 106.825 },
    distanceMeters: 1_600,
    source: GeocodingSource.GATHRA_CSV,
  };
  return {
    name: 'fake',
    autocomplete: jest.fn().mockResolvedValue([
      suggestion,
      {
        ...suggestion,
        providerId: 'fake:venue:outside',
        primaryText: 'Lokasi Uji Bekasi',
        position: { latitude: -6.2, longitude: 107.1 },
      },
    ]),
    search: jest.fn().mockResolvedValue([
      suggestion,
      {
        ...suggestion,
        providerId: 'fake:venue:outside',
        primaryText: 'Lokasi Uji Bekasi',
        position: { latitude: -6.2, longitude: 107.1 },
      },
    ]),
    lookup: jest.fn().mockResolvedValue({
      providerId: suggestion.providerId,
      name: suggestion.primaryText,
      formattedAddress: suggestion.secondaryText,
      position: suggestion.position,
      category: suggestion.category,
      source: suggestion.source,
    }),
    reverse: jest.fn().mockResolvedValue(null),
    health: jest.fn().mockResolvedValue(undefined),
  };
}

function routingProviderStub(): jest.Mocked<RoutingProvider> {
  return {
    preview: jest.fn(),
    health: jest.fn().mockResolvedValue(undefined),
  };
}
