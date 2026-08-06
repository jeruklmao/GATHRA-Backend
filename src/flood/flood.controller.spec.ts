import { FloodController } from './flood.controller';
import { InMemoryFloodHazardProvider } from './providers/in-memory-flood-hazard.provider';
import { ApiException } from '../common/api-error';

describe('FloodController', () => {
  let provider: InMemoryFloodHazardProvider;
  let controller: FloodController;

  beforeEach(() => {
    provider = new InMemoryFloodHazardProvider(
      undefined,
      undefined,
      'controller-test',
    );
    controller = new FloodController(provider);
  });

  it('returns empty GeoJSON FeatureCollection when no hazards active', async () => {
    const res = await controller.getActiveHazards({});
    expect(res.type).toBe('FeatureCollection');
    expect(res.features).toHaveLength(0);
    expect(res.snapshotId).toMatch(/^snapshot_controller-test_v\d+_\d+$/);
  });

  it('returns active hazards after preset activation', async () => {
    provider.activateCentralCorridorPreset('HIGH');
    const res = await controller.getActiveHazards({});

    expect(res.snapshotId).toBe('snapshot_controller-test_v1_2');
    expect(res.features).toHaveLength(2);
    expect(res.features.map((feature) => feature.id)).toEqual([
      'preset_central_corridor_high',
      'preset_user_custom_high',
    ]);
    for (const feature of res.features) {
      expect(feature.properties.riskLevel).toBe('HIGH');
      expect(feature.properties.source).toBe('SIMULATED');
      expect(feature.geometry.type).toBe('Polygon');
      expect(feature.geometry.coordinates[0].length).toBeGreaterThanOrEqual(4);
      expect(feature.geometry.coordinates[0][0]).toEqual(
        feature.geometry.coordinates[0].at(-1),
      );
    }
  });

  it('filters hazards by bounding box intersection', async () => {
    provider.activateCentralCorridorPreset('HIGH'); // Coords: 106.817..106.821, -6.201..-6.193

    // Overlapping bbox
    const hit = await controller.getActiveHazards({
      minLat: -6.205,
      minLon: 106.815,
      maxLat: -6.19,
      maxLon: 106.825,
    });
    expect(hit.features).toHaveLength(2);

    const centralOnly = await controller.getActiveHazards({
      minLat: -6.2,
      minLon: 106.818,
      maxLat: -6.194,
      maxLon: 106.82,
    });
    expect(centralOnly.features.map((feature) => feature.id)).toEqual([
      'preset_central_corridor_high',
    ]);

    const customOnly = await controller.getActiveHazards({
      minLat: -6.208,
      minLon: 106.814,
      maxLat: -6.2025,
      maxLon: 106.819,
    });
    expect(customOnly.features.map((feature) => feature.id)).toEqual([
      'preset_user_custom_high',
    ]);

    // Non-overlapping bbox (far away in Tangerang)
    const miss = await controller.getActiveHazards({
      minLat: -6.18,
      minLon: 106.6,
      maxLat: -6.15,
      maxLon: 106.65,
    });
    expect(miss.features).toHaveLength(0);
  });

  it('keeps snapshot ID stable until active state changes and clear returns zero hazards', async () => {
    provider.activateCentralCorridorPreset('BLOCKED');
    const first = await controller.getActiveHazards({});
    const unchanged = await controller.getActiveHazards({});

    expect(first.snapshotId).toBe(unchanged.snapshotId);
    expect(first.features).toHaveLength(2);
    expect(
      first.features.every((feature) => feature.properties.riskLevel === 'BLOCKED'),
    ).toBe(true);

    provider.clearHazards();
    const cleared = await controller.getActiveHazards({});
    expect(cleared.features).toHaveLength(0);
    expect(cleared.snapshotId).not.toBe(first.snapshotId);
  });

  it('excludes expired hazards from the active snapshot', async () => {
    let now = new Date('2026-07-30T10:00:00.000Z');
    provider = new InMemoryFloodHazardProvider(
      () => now,
      undefined,
      'controller-test',
    );
    controller = new FloodController(provider);
    provider.addHazard({
      id: 'short-lived',
      level: 'HIGH',
      confidence: 0.8,
      observedAt: '2026-07-30T09:00:00.000Z',
      validUntil: '2026-07-30T10:01:00.000Z',
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
    });

    expect((await controller.getActiveHazards({})).features).toHaveLength(1);
    now = new Date('2026-07-30T10:02:00.000Z');
    const expired = await controller.getActiveHazards({});
    expect(expired.features).toHaveLength(0);
    expect(expired.snapshotId).toBe('snapshot_controller-test_v1_0');
  });

  it('rejects incomplete bounding box query parameters', async () => {
    await expect(
      controller.getActiveHazards({ minLat: -6.2 }),
    ).rejects.toMatchObject<Partial<ApiException>>({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects invalid minLat >= maxLat', async () => {
    await expect(
      controller.getActiveHazards({
        minLat: -6.1,
        minLon: 106.7,
        maxLat: -6.2,
        maxLon: 106.8,
      }),
    ).rejects.toMatchObject<Partial<ApiException>>({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });
});
