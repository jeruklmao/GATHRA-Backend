import { ApiException } from '../common/api-error';
import { RouteFloodEvaluator } from '../flood/geometry/route-flood-evaluator';
import { InMemoryFloodHazardProvider } from '../flood/providers/in-memory-flood-hazard.provider';
import { TravelModeDto } from './dto/route-preview-request.dto';
import {
  NavigationManoeuvreType,
  NavigationModifier,
  type RoutingProvider,
  RoutingProviderError,
} from './routing-provider';
import { RoutesService } from './routes.service';

describe('RoutesService', () => {
  let provider: jest.Mocked<RoutingProvider>;
  let floodProvider: InMemoryFloodHazardProvider;
  let floodEvaluator: RouteFloodEvaluator;
  let service: RoutesService;

  beforeEach(() => {
    provider = {
      preview: jest.fn(),
      health: jest.fn(),
    };
    floodProvider = new InMemoryFloodHazardProvider();
    floodEvaluator = new RouteFloodEvaluator();
    service = new RoutesService(provider, floodProvider, floodEvaluator);
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
    expect(first.metadata.travelMode).toBe(TravelModeDto.CAR);
    expect(first.metadata.flood).toBeDefined();
    expect(first.routes[0].id).toBe(second.routes[0].id);
    expect(first.routes[0].id).toMatch(/^route_[a-f0-9]{16}$/);
  });

  it('ranks lower flood risk route over a faster high-risk route', async () => {
    // Route A: 10 mins, but passes through high flood
    // Route B: 15 mins, clear of flood
    floodProvider.activateCentralCorridorPreset('HIGH');

    const routeHighRiskFast = {
      ...route([
        [106.817, -6.201],
        [106.821, -6.193], // Passes through central corridor
      ]),
      durationSeconds: 600,
    };

    const routeLowRiskSlow = {
      ...route([
        [106.8, -6.201],
        [106.8, -6.193], // Outside central corridor
      ]),
      durationSeconds: 900,
    };

    provider.preview.mockResolvedValue([routeHighRiskFast, routeLowRiskSlow]);

    const request = {
      origin: { latitude: -6.201, longitude: 106.817 },
      destination: { latitude: -6.193, longitude: 106.821 },
      travelMode: TravelModeDto.CAR,
      alternatives: 1,
    };

    const response = await service.preview('request-flood', request);
    expect(response.routes[0].isRecommended).toBe(true);
    expect(response.routes[0].risk?.level).toBe('LOW');
    expect(response.routes[1].isRecommended).toBe(false);
    expect(response.routes[1].risk?.level).toBe('HIGH');
  });

  it('rejects origin inside a BLOCKED hazard area', async () => {
    floodProvider.activateCentralCorridorPreset('BLOCKED');
    const request = {
      origin: { latitude: -6.196, longitude: 106.819 }, // Inside central corridor preset
      destination: { latitude: -6.15, longitude: 106.85 },
      travelMode: TravelModeDto.CAR,
      alternatives: 1,
    };

    await expect(service.preview('req-blocked', request)).rejects.toMatchObject<
      Partial<ApiException>
    >({
      status: 422,
      code: 'ORIGIN_IN_BLOCKED_AREA',
    });
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
});

function route(coordinates: readonly (readonly [number, number])[]) {
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
        instruction: 'Mulai',
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
