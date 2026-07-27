import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app-bootstrap';
import { TravelModeDto } from '../src/routes/dto/route-preview-request.dto';
import {
  NavigationManoeuvreType,
  NavigationModifier,
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
          steps: [
            {
              index: 0,
              instruction: 'Mulai menuju Jalan Uji',
              manoeuvre: {
                type: 'DEPART',
                modifier: 'STRAIGHT',
              },
              geometryStartIndex: 0,
              geometryEndIndex: 1,
            },
            {
              index: 1,
              instruction: 'Anda telah tiba',
              manoeuvre: {
                type: 'ARRIVE',
                modifier: 'NONE',
              },
              geometryStartIndex: 1,
              geometryEndIndex: 1,
            },
          ],
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
    expect(response.body.routes[0].steps.at(-1).manoeuvre.type).toBe('ARRIVE');
    for (const route of response.body.routes) {
      const steps = route.steps as Array<{
        index: number;
        geometryStartIndex: number;
        geometryEndIndex: number;
      }>;
      expect(steps.map((step) => step.index)).toEqual(
        steps.map((_, index) => index),
      );
      expect(steps[0].geometryStartIndex).toBe(0);
      expect(steps.at(-1)?.geometryEndIndex).toBe(
        route.geometry.coordinates.length - 1,
      );
      for (let index = 1; index < steps.length; index += 1) {
        expect(steps[index].geometryStartIndex).toBe(
          steps[index - 1].geometryEndIndex,
        );
      }
    }
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

  it('returns a clear gateway error for malformed provider instructions', async () => {
    provider.preview.mockRejectedValue(
      new RoutingProviderError('INVALID_RESPONSE', {
        cause: new Error('malformed instruction interval'),
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/api/v1/routes/preview')
      .send(validRequest())
      .expect(502);

    expect(response.body.error).toEqual({
      code: 'ROUTING_RESPONSE_INVALID',
      message: 'The routing engine returned an invalid response.',
      retryable: true,
    });
    expect(JSON.stringify(response.body)).not.toContain(
      'malformed instruction interval',
    );
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
  const lastIndex = coordinates.length - 1;
  return {
    geometry: {
      type: 'LineString' as const,
      coordinates,
    },
    distanceMeters: 1_000,
    durationSeconds: 120,
    steps: [
      {
        index: 0,
        instruction: 'Mulai menuju Jalan Uji',
        streetName: 'Jalan Uji',
        distanceMeters: 1_000,
        durationSeconds: 120,
        manoeuvre: {
          type: NavigationManoeuvreType.DEPART,
          modifier: NavigationModifier.STRAIGHT,
          bearingBefore: null,
          bearingAfter: 90,
        },
        geometryStartIndex: 0,
        geometryEndIndex: lastIndex,
      },
      {
        index: 1,
        instruction: 'Anda telah tiba',
        streetName: '',
        distanceMeters: 0,
        durationSeconds: 0,
        manoeuvre: {
          type: NavigationManoeuvreType.ARRIVE,
          modifier: NavigationModifier.NONE,
          bearingBefore: 90,
          bearingAfter: null,
        },
        geometryStartIndex: lastIndex,
        geometryEndIndex: lastIndex,
      },
    ],
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
