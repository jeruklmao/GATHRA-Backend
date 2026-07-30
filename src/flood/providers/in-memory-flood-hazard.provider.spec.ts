import { FloodGeometryValidationError } from '../geometry/flood-geometry.validator';
import { InMemoryFloodHazardProvider } from './in-memory-flood-hazard.provider';

describe('InMemoryFloodHazardProvider configured limits', () => {
  it('enforces the configured active-hazard maximum for direct mutations', () => {
    const provider = new InMemoryFloodHazardProvider(
      undefined,
      {
        maxActiveHazards: 1,
        maxPolygonVertices: 10,
      },
    );

    provider.addHazard(hazard('first'));

    expect(() => provider.addHazard(hazard('second'))).toThrow(
      FloodGeometryValidationError,
    );
    expect(provider.listHazards().map(({ id }) => id)).toEqual(['first']);
  });

  it('validates a preset atomically against the configured hazard maximum', () => {
    const provider = new InMemoryFloodHazardProvider(
      undefined,
      {
        maxActiveHazards: 1,
        maxPolygonVertices: 10,
      },
    );

    expect(() => provider.activateCentralCorridorPreset('HIGH')).toThrow(
      FloodGeometryValidationError,
    );
    expect(provider.listHazards()).toHaveLength(0);
  });

  it('enforces the configured polygon-vertex maximum', () => {
    const provider = new InMemoryFloodHazardProvider(
      undefined,
      {
        maxActiveHazards: 10,
        maxPolygonVertices: 4,
      },
    );

    expect(() =>
      provider.addHazard({
        ...hazard('too-many-vertices'),
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [106.8, -6.2],
              [106.81, -6.2],
              [106.81, -6.19],
              [106.8, -6.19],
              [106.8, -6.2],
            ],
          ],
        },
      }),
    ).toThrow(FloodGeometryValidationError);
  });

  it('excludes expired stored hazards from an activated preset snapshot', () => {
    const now = new Date('2026-07-30T09:00:00.000Z');
    const provider = new InMemoryFloodHazardProvider(
      () => now,
      {
        maxActiveHazards: 10,
        maxPolygonVertices: 10,
      },
    );

    provider.addHazard({
      ...hazard('expired'),
      observedAt: '2026-07-30T08:00:00.000Z',
      validUntil: '2026-07-30T08:59:59.000Z',
    });

    const snapshot = provider.activateCentralCorridorPreset('HIGH');

    expect(snapshot.hazards).toHaveLength(2);
    expect(snapshot.hazards.map(({ id }) => id)).toEqual([
      'preset_central_corridor_high',
      'preset_user_custom_high',
    ]);
    expect(snapshot.snapshotId).toBe('snapshot_v2_2');
  });
});

function hazard(id: string) {
  return {
    id,
    level: 'HIGH',
    confidence: 0.8,
    observedAt: '2026-07-30T09:00:00.000Z',
    validUntil: '2030-07-30T10:00:00.000Z',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [106.8, -6.2],
          [106.81, -6.2],
          [106.81, -6.19],
          [106.8, -6.2],
        ],
      ],
    },
  };
}
