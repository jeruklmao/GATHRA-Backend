import { GraphHopperClient } from './graphhopper.client';
import { TravelModeDto } from './dto/route-preview-request.dto';
import { RoutingProviderError } from './routing-provider';
import type {
  FloodHazard,
  FloodRiskLevel,
} from '../flood/models/flood-hazard';

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
      steps: [
        {
          index: 0,
          instruction: 'Mulai',
          manoeuvre: {
            type: 'DEPART',
            bearingBefore: null,
          },
        },
        {
          index: 1,
          instruction: 'Anda telah tiba',
          manoeuvre: {
            type: 'ARRIVE',
            bearingAfter: null,
          },
        },
      ],
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
      instructions: true,
      locale: 'id',
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

  it('maps turn signs and derives bearings from route geometry', async () => {
    const coordinates = [
      [106.8167, -6.2],
      [106.8177, -6.2],
      [106.8177, -6.201],
    ];
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        paths: [
          graphHopperPath(1_000, 60_000, coordinates, [
            graphHopperInstruction(0, [0, 1], 'Mulai menuju Jalan A', 'Jalan A'),
            graphHopperInstruction(2, [1, 2], 'Belok kanan ke Jalan B', 'Jalan B'),
            graphHopperInstruction(4, [2, 2], 'Anda telah tiba', ''),
          ]),
        ],
      }),
    );

    const [route] = await new GraphHopperClient().preview({
      origin: { latitude: -6.2, longitude: 106.8167 },
      destination: { latitude: -6.201, longitude: 106.8177 },
      travelMode: TravelModeDto.CAR,
      alternatives: 0,
    });

    expect(route.steps).toEqual([
      {
        index: 0,
        instruction: 'Mulai menuju Jalan A',
        streetName: 'Jalan A',
        distanceMeters: 100,
        durationSeconds: 10,
        manoeuvre: {
          type: 'DEPART',
          modifier: 'STRAIGHT',
          bearingBefore: null,
          bearingAfter: 90,
        },
        geometryStartIndex: 0,
        geometryEndIndex: 1,
      },
      {
        index: 1,
        instruction: 'Belok kanan ke Jalan B',
        streetName: 'Jalan B',
        distanceMeters: 100,
        durationSeconds: 10,
        manoeuvre: {
          type: 'TURN',
          modifier: 'RIGHT',
          bearingBefore: 90,
          bearingAfter: 180,
        },
        geometryStartIndex: 1,
        geometryEndIndex: 2,
      },
      {
        index: 2,
        instruction: 'Anda telah tiba',
        streetName: '',
        distanceMeters: 100,
        durationSeconds: 10,
        manoeuvre: {
          type: 'ARRIVE',
          modifier: 'NONE',
          bearingBefore: 180,
          bearingAfter: null,
        },
        geometryStartIndex: 2,
        geometryEndIndex: 2,
      },
    ]);
  });

  it.each([
    [-1, 'SLIGHT_TURN', 'SLIGHT_LEFT'],
    [1, 'SLIGHT_TURN', 'SLIGHT_RIGHT'],
    [-2, 'TURN', 'LEFT'],
    [2, 'TURN', 'RIGHT'],
    [-3, 'SHARP_TURN', 'SHARP_LEFT'],
    [3, 'SHARP_TURN', 'SHARP_RIGHT'],
    [-98, 'U_TURN', 'U_TURN'],
    [-8, 'U_TURN', 'U_TURN'],
    [8, 'U_TURN', 'U_TURN'],
    [6, 'ROUNDABOUT', 'STRAIGHT'],
    [-6, 'EXIT_ROUNDABOUT', 'STRAIGHT'],
    [-7, 'FORK', 'SLIGHT_LEFT'],
    [7, 'FORK', 'SLIGHT_RIGHT'],
    [99, 'UNKNOWN', 'NONE'],
  ])(
    'maps provider sign %i to %s/%s',
    async (sign, expectedType, expectedModifier) => {
      const coordinates = [
        [106.8167, -6.2],
        [106.817, -6.2],
        [106.8173, -6.2],
      ];
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({
          paths: [
            graphHopperPath(100, 10_000, coordinates, [
              graphHopperInstruction(0, [0, 1], 'Mulai', ''),
              graphHopperInstruction(sign, [1, 2], 'Instruksi', 'Jalan Uji'),
              graphHopperInstruction(4, [2, 2], 'Tiba', ''),
            ]),
          ],
        }),
      );

      const [route] = await new GraphHopperClient().preview({
        origin: { latitude: -6.2, longitude: 106.8167 },
        destination: { latitude: -6.2, longitude: 106.8173 },
        travelMode: TravelModeDto.CAR,
        alternatives: 0,
      });

      expect(route.steps[1].manoeuvre).toMatchObject({
        type: expectedType,
        modifier: expectedModifier,
      });
    },
  );

  it.each([
    ['missing instructions', undefined],
    [
      'a discontinuous interval',
      [
        graphHopperInstruction(0, [0, 1], 'Mulai', ''),
        graphHopperInstruction(2, [2, 2], 'Belok kanan', ''),
        graphHopperInstruction(4, [2, 2], 'Tiba', ''),
      ],
    ],
    [
      'an out-of-order interval',
      [
        graphHopperInstruction(0, [0, 1], 'Mulai', ''),
        graphHopperInstruction(2, [1, 0], 'Belok kanan', ''),
        graphHopperInstruction(4, [2, 2], 'Tiba', ''),
      ],
    ],
    [
      'an intermediate arrival',
      [
        graphHopperInstruction(0, [0, 1], 'Mulai', ''),
        graphHopperInstruction(4, [1, 2], 'Tiba terlalu cepat', ''),
        graphHopperInstruction(4, [2, 2], 'Tiba', ''),
      ],
    ],
    [
      'a non-arrival final instruction',
      [
        graphHopperInstruction(0, [0, 1], 'Mulai', ''),
        graphHopperInstruction(2, [1, 2], 'Belok kanan', ''),
        graphHopperInstruction(0, [2, 2], 'Lanjut', ''),
      ],
    ],
  ])('rejects provider steps with %s', async (_label, instructions) => {
    const path = graphHopperPath(
      100,
      10_000,
      [
        [106.8167, -6.2],
        [106.817, -6.2],
        [106.8173, -6.2],
      ],
      instructions,
    ) as Record<string, unknown>;
    if (instructions === undefined) {
      delete path.instructions;
    }
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ paths: [path] }),
    );

    await expect(
      new GraphHopperClient().preview({
        origin: { latitude: -6.2, longitude: 106.8167 },
        destination: { latitude: -6.2, longitude: 106.8173 },
        travelMode: TravelModeDto.CAR,
        alternatives: 0,
      }),
    ).rejects.toMatchObject<Partial<RoutingProviderError>>({
      kind: 'INVALID_RESPONSE',
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

  it.each([
    ['LOW', 1, false, TravelModeDto.CAR],
    ['UNKNOWN', 1, false, TravelModeDto.CAR],
    ['MEDIUM', 0.35, true, TravelModeDto.CAR],
    ['HIGH', 0.05, true, TravelModeDto.CAR],
    ['BLOCKED', 0, true, TravelModeDto.CAR],
    ['MEDIUM', 0.7, true, TravelModeDto.CAR],
    ['UNKNOWN', 0.5, true, TravelModeDto.CAR],
    ['BLOCKED', 0.2, true, TravelModeDto.CAR],
    ['MEDIUM', 0.35, true, TravelModeDto.MOTORCYCLE],
  ] as const)(
    'uses runtime %s multiplier %s in the custom model (present=%s, mode=%s)',
    async (level, routingMultiplier, hasCustomModel, travelMode) => {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({
          paths: [
            graphHopperPath(1_000, 60_000, [
              [106.8167, -6.2],
              [106.82, -6.196],
            ]),
          ],
        }),
      );

      await new GraphHopperClient().preview({
        origin: { latitude: -6.2, longitude: 106.8167 },
        destination: { latitude: -6.196, longitude: 106.82 },
        travelMode,
        alternatives: 0,
        hazards: [hazard(level, routingMultiplier)],
      });

      const payload = JSON.parse(
        String(fetchMock.mock.calls[0][1]?.body),
      ) as Record<string, unknown>;
      expect(payload.profile).toBe(
        travelMode === TravelModeDto.CAR ? 'car' : 'motorcycle',
      );
      if (!hasCustomModel) {
        expect(payload.custom_model).toBeUndefined();
        expect(payload['ch.disable']).toBeUndefined();
      } else {
        expect(payload.custom_model).toMatchObject({
          areas: {
            type: 'FeatureCollection',
            features: [{ id: expect.stringMatching(/^flood_area_/) }],
          },
          priority: [
            {
              if: expect.stringMatching(/^in_flood_area_/),
              multiply_by: String(routingMultiplier),
            },
          ],
        });
        expect(payload['ch.disable']).toBe(true);
      }
    },
  );

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

function hazard(
  level: FloodRiskLevel,
  routingMultiplier: number,
): FloodHazard {
  return {
    id: `runtime-${level}-${routingMultiplier}`,
    level,
    routingMultiplier,
    confidence: 1,
    observedAt: new Date('2026-08-26T00:00:00.000Z'),
    validUntil: new Date('2026-08-26T01:00:00.000Z'),
    sourceNodeIds: ['N1'],
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [106.817, -6.201],
          [106.819, -6.201],
          [106.819, -6.199],
          [106.817, -6.199],
          [106.817, -6.201],
        ],
      ],
    },
  };
}

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
  instructions: unknown = defaultInstructions(coordinates),
): unknown {
  return {
    distance,
    time,
    points: {
      type: 'LineString',
      coordinates,
    },
    instructions,
  };
}

function defaultInstructions(coordinates: number[][]): unknown[] {
  const lastIndex = coordinates.length - 1;
  return [
    graphHopperInstruction(0, [0, lastIndex], 'Mulai', ''),
    graphHopperInstruction(4, [lastIndex, lastIndex], 'Anda telah tiba', ''),
  ];
}

function graphHopperInstruction(
  sign: number,
  interval: [number, number],
  text: string,
  streetName: string,
): unknown {
  return {
    sign,
    interval,
    text,
    street_name: streetName,
    distance: 100.4,
    time: 9_001,
  };
}
