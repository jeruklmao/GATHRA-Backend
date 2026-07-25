import { ApiException } from '../common/api-error';
import { TravelModeDto } from './dto/route-preview-request.dto';
import {
  type RoutingProvider,
  RoutingProviderError,
} from './routing-provider';
import { RoutesService } from './routes.service';

describe('RoutesService', () => {
  let provider: jest.Mocked<RoutingProvider>;
  let service: RoutesService;

  beforeEach(() => {
    provider = {
      preview: jest.fn(),
      health: jest.fn(),
    };
    service = new RoutesService(provider);
  });

  it('returns a recommended route, alternative, metadata, and stable IDs', async () => {
    provider.preview.mockResolvedValue([
      route([
        [106.8167, -6.2],
        [106.82, -6.196],
      ]),
      route([
        [106.8167, -6.2],
        [106.818, -6.192],
        [106.82, -6.196],
      ]),
    ]);
    const request = {
      origin: { latitude: -6.2, longitude: 106.8167 },
      destination: { latitude: -6.196, longitude: 106.82 },
      travelMode: TravelModeDto.CAR,
      alternatives: 1,
    };

    const first = await service.preview('request-1', request);
    const second = await service.preview('request-2', request);

    expect(first.routes).toHaveLength(2);
    expect(first.routes.map((item) => item.isRecommended)).toEqual([
      true,
      false,
    ]);
    expect(first.metadata).toEqual({
      travelMode: TravelModeDto.CAR,
      requestedAlternatives: 1,
      returnedAlternatives: 1,
    });
    expect(first.routes[0].id).toBe(second.routes[0].id);
    expect(first.routes[0].id).toMatch(/^route_[a-f0-9]{16}$/);
  });

  it('rejects identical endpoints before calling the provider', async () => {
    await expect(
      service.preview('request-1', {
        origin: { latitude: -6.2, longitude: 106.8167 },
        destination: { latitude: -6.2, longitude: 106.8167 },
        travelMode: TravelModeDto.CAR,
        alternatives: 1,
      }),
    ).rejects.toMatchObject<Partial<ApiException>>({
      status: 400,
      code: 'VALIDATION_ERROR',
      retryable: false,
    });
    expect(provider.preview).not.toHaveBeenCalled();
  });

  it.each([
    ['NO_ROUTE', 422, 'NO_ROUTE', false],
    ['TIMEOUT', 504, 'ROUTING_TIMEOUT', true],
    ['INVALID_RESPONSE', 502, 'ROUTING_RESPONSE_INVALID', true],
    ['UNAVAILABLE', 503, 'ROUTING_UNAVAILABLE', true],
  ] as const)(
    'maps provider %s errors',
    async (providerKind, expectedStatus, expectedCode, retryable) => {
      provider.preview.mockRejectedValue(
        new RoutingProviderError(providerKind),
      );

      await expect(
        service.preview('request-1', {
          origin: { latitude: -6.2, longitude: 106.8167 },
          destination: { latitude: -6.196, longitude: 106.82 },
          travelMode: TravelModeDto.CAR,
          alternatives: 1,
        }),
      ).rejects.toMatchObject<Partial<ApiException>>({
        status: expectedStatus,
        code: expectedCode,
        retryable,
      });
    },
  );
});

function route(coordinates: readonly (readonly [number, number])[]) {
  return {
    geometry: {
      type: 'LineString' as const,
      coordinates,
    },
    distanceMeters: 1_000,
    durationSeconds: 120,
  };
}
