import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app-bootstrap';
import { TravelModeDto } from '../src/routes/dto/route-preview-request.dto';
import {
  type RoutingProvider,
  ROUTING_PROVIDER,
  RoutingProviderError,
} from '../src/routes/routing-provider';

describe('routing API (integration)', () => {
  let app: INestApplication;
  let provider: jest.Mocked<RoutingProvider>;

  beforeEach(async () => {
    provider = {
      preview: jest.fn().mockResolvedValue([
        providerRoute([
          [106.8167, -6.2],
          [106.82, -6.196],
        ]),
        providerRoute([
          [106.8167, -6.2],
          [106.818, -6.192],
          [106.82, -6.196],
        ]),
      ]),
      health: jest.fn().mockResolvedValue(undefined),
    };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ROUTING_PROVIDER)
      .useValue(provider)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns two framework-independent GeoJSON routes', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/routes/preview')
      .set('x-request-id', 'integration-request')
      .send(validRequest())
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('x-request-id', 'integration-request');

    expect(response.body).toMatchObject({
      requestId: 'integration-request',
      routes: [
        {
          isRecommended: true,
          geometry: { type: 'LineString' },
          summary: { distanceMeters: 1_000, durationSeconds: 120 },
        },
        {
          isRecommended: false,
          geometry: { type: 'LineString' },
        },
      ],
      metadata: {
        travelMode: 'CAR',
        requestedAlternatives: 1,
        returnedAlternatives: 1,
      },
    });
    expect(response.body.routes[0].geometry.coordinates[0]).toEqual([
      106.8167, -6.2,
    ]);
  });

  it.each([
    ['numeric strings', { origin: { latitude: '-6.2', longitude: 106.8167 } }],
    ['unknown properties', { unexpected: true }],
    ['invalid coordinates', { origin: { latitude: -91, longitude: 106.8167 } }],
    ['invalid mode', { travelMode: 'BICYCLE' }],
    ['too many alternatives', { alternatives: 2 }],
  ])('rejects %s using the standard envelope', async (_label, patch) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/routes/preview')
      .send(deepMerge(validRequest(), patch))
      .expect(400);

    expect(response.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        retryable: false,
      },
    });
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(provider.preview).not.toHaveBeenCalled();
  });

  it('rejects identical endpoints', async () => {
    const body = validRequest();
    body.destination = { ...body.origin };

    const response = await request(app.getHttpServer())
      .post('/api/v1/routes/preview')
      .send(body)
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      retryable: false,
      details: [{ field: 'destination', reason: 'must differ from origin' }],
    });
  });

  it('maps a no-route provider result without leaking provider details', async () => {
    provider.preview.mockRejectedValue(
      new RoutingProviderError('NO_ROUTE', {
        cause: new Error('GraphHopper internal details'),
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/api/v1/routes/preview')
      .send(validRequest())
      .expect(422);

    expect(response.body.error).toEqual({
      code: 'NO_ROUTE',
      message: 'No route could be found between the selected points.',
      retryable: false,
    });
    expect(JSON.stringify(response.body)).not.toContain('GraphHopper');
  });

  it('normalizes an unsupported route method as not found', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/routes/preview')
      .expect(404);

    expect(response.body).toMatchObject({
      error: {
        code: 'NOT_FOUND',
        retryable: false,
      },
    });
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(provider.preview).not.toHaveBeenCalled();
  });

  it('reports routing readiness and publishes OpenAPI JSON', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200, {
        status: 'ok',
        service: 'gathra-routing-api',
        checks: { routing: 'up' },
      });

    const docs = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(docs.body.paths).toHaveProperty('/api/v1/routes/preview');
  });

  it('returns 503 when GraphHopper is not ready', async () => {
    provider.health.mockRejectedValue(new Error('offline'));

    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503, {
        status: 'unavailable',
        service: 'gathra-routing-api',
        checks: { routing: 'down' },
      });
  });
});

function validRequest() {
  return {
    origin: { latitude: -6.2, longitude: 106.8167 },
    destination: { latitude: -6.196, longitude: 106.82 },
    travelMode: TravelModeDto.CAR,
    alternatives: 1,
  };
}

function providerRoute(
  coordinates: readonly (readonly [number, number])[],
) {
  return {
    geometry: {
      type: 'LineString' as const,
      coordinates,
    },
    distanceMeters: 1_000,
    durationSeconds: 120,
  };
}

function deepMerge<T extends Record<string, unknown>>(
  original: T,
  patch: Record<string, unknown>,
): T {
  const merged = { ...original } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key];
    merged[key] =
      isRecord(current) && isRecord(value)
        ? deepMerge(current, value)
        : value;
  }
  return merged as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
