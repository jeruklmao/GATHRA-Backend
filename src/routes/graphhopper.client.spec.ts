import { GraphHopperClient } from './graphhopper.client';
import { TravelModeDto } from './dto/route-preview-request.dto';
import { RoutingProviderError } from './routing-provider';

const originalEnvironment = { ...process.env };

describe('GraphHopperClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnvironment };
  });

  it('maps a motorcycle alternative response into provider routes', async () => {
    process.env.ROUTING_ENGINE_BASE_URL = 'http://engine.test:8989/';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        paths: [
          graphHopperPath(1_234.4, 101_001, [
            [106.8167, -6.2],
            [106.82, -6.196],
          ]),
          graphHopperPath(1_400.6, 110_010, [
            [106.8167, -6.2],
            [106.818, -6.194],
            [106.82, -6.196],
          ]),
        ],
      }),
    );
    const client = new GraphHopperClient();

    const result = await client.preview({
      origin: { latitude: -6.2, longitude: 106.8167 },
      destination: { latitude: -6.196, longitude: 106.82 },
      travelMode: TravelModeDto.MOTORCYCLE,
      alternatives: 1,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      distanceMeters: 1_234,
      durationSeconds: 102,
    });
    const [url, init] = fetchMock.mock.calls[0];
    const parsedUrl = new URL(String(url));
    expect(parsedUrl.pathname).toBe('/route');
    expect(JSON.parse(String(init?.body))).toEqual({
      profile: 'motorcycle',
      points: [
        [106.8167, -6.2],
        [106.82, -6.196],
      ],
      points_encoded: false,
      instructions: false,
      calc_points: true,
      timeout_ms: 8_000,
      algorithm: 'alternative_route',
      'ch.disable': true,
      'alternative_route.max_paths': 2,
      'alternative_route.max_weight_factor': 1.6,
      'alternative_route.max_share_factor': 0.8,
      'alternative_route.max_exploration_factor': 2.0,
      'alternative_route.min_plateau_factor': 0.05,
    });
  });

  it('rejects malformed provider geometry', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        paths: [
          graphHopperPath(1_000, 60_000, [
            [206.8167, -6.2],
            [106.82, -6.196],
          ]),
        ],
      }),
    );

    await expect(
      new GraphHopperClient().preview({
        origin: { latitude: -6.2, longitude: 106.8167 },
        destination: { latitude: -6.196, longitude: 106.82 },
        travelMode: TravelModeDto.CAR,
        alternatives: 0,
      }),
    ).rejects.toMatchObject<Partial<RoutingProviderError>>({
      kind: 'INVALID_RESPONSE',
    });
  });

  it('rejects routes snapped too far from the requested endpoints', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        paths: [
          graphHopperPath(1_000, 60_000, [
            [112.7521, -7.2575],
            [112.76, -7.26],
          ]),
        ],
      }),
    );

    await expect(
      new GraphHopperClient().preview({
        origin: { latitude: -6.2, longitude: 106.8167 },
        destination: { latitude: -6.196, longitude: 106.82 },
        travelMode: TravelModeDto.CAR,
        alternatives: 0,
      }),
    ).rejects.toMatchObject<Partial<RoutingProviderError>>({
      kind: 'NO_ROUTE',
    });
  });

  it('classifies a GraphHopper connection failure as no route', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'ConnectionNotFoundException: Cannot find path',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      new GraphHopperClient().preview({
        origin: { latitude: -6.2, longitude: 106.8167 },
        destination: { latitude: -6.196, longitude: 106.82 },
        travelMode: TravelModeDto.CAR,
        alternatives: 0,
      }),
    ).rejects.toMatchObject<Partial<RoutingProviderError>>({
      kind: 'NO_ROUTE',
    });
  });

  it('classifies an out of coverage point as no route', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'Point 0 is out of bounds',
          hints: [
            {
              details:
                'com.graphhopper.util.exceptions.PointOutOfBoundsException',
            },
          ],
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      new GraphHopperClient().preview({
        origin: { latitude: -7.2575, longitude: 112.7521 },
        destination: { latitude: -7.26, longitude: 112.76 },
        travelMode: TravelModeDto.CAR,
        alternatives: 0,
      }),
    ).rejects.toMatchObject<Partial<RoutingProviderError>>({
      kind: 'NO_ROUTE',
    });
  });

  it('classifies an aborted provider request as a timeout', async () => {
    process.env.ROUTING_ENGINE_TIMEOUT_MS = '1';
    jest.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    await expect(
      new GraphHopperClient().preview({
        origin: { latitude: -6.2, longitude: 106.8167 },
        destination: { latitude: -6.196, longitude: 106.82 },
        travelMode: TravelModeDto.CAR,
        alternatives: 0,
      }),
    ).rejects.toMatchObject<Partial<RoutingProviderError>>({
      kind: 'TIMEOUT',
    });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function graphHopperPath(
  distance: number,
  time: number,
  coordinates: number[][],
): unknown {
  return {
    distance,
    time,
    points: {
      type: 'LineString',
      coordinates,
    },
  };
}
