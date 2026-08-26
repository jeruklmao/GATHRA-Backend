import { RouteFloodEvaluator } from './route-flood-evaluator';
import type { FloodHazard } from '../models/flood-hazard';

describe('RouteFloodEvaluator', () => {
  const evaluator = new RouteFloodEvaluator();

  const samplePolygon = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [106.81, -6.2],
        [106.83, -6.2],
        [106.83, -6.18],
        [106.81, -6.18],
        [106.81, -6.2],
      ] as [number, number][],
    ],
  };

  const sampleHazard: FloodHazard = {
    id: 'h1',
    level: 'HIGH',
    geometry: samplePolygon,
    confidence: 0.9,
    observedAt: new Date('2026-07-27T10:00:00Z'),
    validUntil: new Date('2026-07-27T12:00:00Z'),
    sourceNodeIds: [],
    routingMultiplier: 0.05,
  };

  it('evaluates a route entirely outside hazards as LOW risk', () => {
    const coords: [number, number][] = [
      [106.8, -6.1],
      [106.8, -6.0],
    ];
    const risk = evaluator.evaluateRoute(coords, 1000, [sampleHazard], 'snap-1');

    expect(risk.level).toBe('LOW');
    expect(risk.score).toBe(0);
    expect(risk.intersectsBlockedArea).toBe(false);
    expect(risk.affectedDistanceMeters).toBe(0);
    expect(risk.reasonCodes).toContain('NO_ACTIVE_FLOOD_INTERSECTION');
  });

  it('evaluates a route passing through a HIGH hazard', () => {
    const coords: [number, number][] = [
      [106.8, -6.19], // Outside
      [106.82, -6.19], // Inside
      [106.84, -6.19], // Outside
    ];
    const risk = evaluator.evaluateRoute(coords, 4000, [sampleHazard], 'snap-1');

    expect(risk.level).toBe('HIGH');
    expect(risk.score).toBeGreaterThanOrEqual(0.7);
    expect(risk.intersectsBlockedArea).toBe(false);
    expect(risk.affectedDistanceMeters).toBeGreaterThan(0);
    expect(risk.reasonCodes).toContain('FLOOD_HAZARD_INTERSECTION');
  });

  it('detects a BLOCKED hazard intersection', () => {
    const blockedHazard: FloodHazard = {
      ...sampleHazard,
      id: 'h-blocked',
      level: 'BLOCKED',
      routingMultiplier: 0,
    };
    const coords: [number, number][] = [
      [106.82, -6.19],
      [106.825, -6.19],
    ];
    const risk = evaluator.evaluateRoute(coords, 1000, [blockedHazard], 'snap-1');

    expect(risk.level).toBe('BLOCKED');
    expect(risk.score).toBe(1.0);
    expect(risk.intersectsBlockedArea).toBe(true);
    expect(risk.reasonCodes).toContain('BLOCKED_HAZARD_INTERSECTION');
  });

  it.each([
    ['LOW', 1, 0, false],
    ['UNKNOWN', 1, 0, false],
    ['MEDIUM', 0.35, 0.65, false],
    ['HIGH', 0.05, 0.95, false],
    ['BLOCKED', 0, 1, true],
    ['BLOCKED', 0.2, 0.8, false],
    ['MEDIUM', 0, 1, true],
    ['UNKNOWN', 0.5, 0.5, false],
  ] as const)(
    'uses runtime %s multiplier %s for score %s and hard exclusion %s',
    (level, routingMultiplier, score, hardExcluded) => {
      const risk = evaluator.evaluateRoute(
        [
          [106.82, -6.19],
          [106.825, -6.19],
        ],
        1_000,
        [{ ...sampleHazard, level, routingMultiplier }],
        'snap-runtime',
      );
      expect(risk).toMatchObject({
        level,
        score,
        intersectsBlockedArea: hardExcluded,
      });
    },
  );
});
