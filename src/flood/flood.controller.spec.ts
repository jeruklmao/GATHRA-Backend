import { FloodController } from './flood.controller';
import { InMemoryFloodHazardProvider } from './providers/in-memory-flood-hazard.provider';
import { ApiException } from '../common/api-error';

describe('FloodController', () => {
  let provider: InMemoryFloodHazardProvider;
  let controller: FloodController;

  beforeEach(() => {
    provider = new InMemoryFloodHazardProvider();
    controller = new FloodController(provider);
  });

  it('returns empty GeoJSON FeatureCollection when no hazards active', async () => {
    const res = await controller.getActiveHazards({});
    expect(res.type).toBe('FeatureCollection');
    expect(res.features).toHaveLength(0);
    expect(res.snapshotId).toMatch(/^snapshot_v\d+_\d+$/);
  });

  it('returns active hazards after preset activation', async () => {
    provider.activateCentralCorridorPreset('HIGH');
    const res = await controller.getActiveHazards({});

    expect(res.features).toHaveLength(1);
    expect(res.features[0].id).toBe('preset_central_corridor_high');
    expect(res.features[0].properties.riskLevel).toBe('HIGH');
    expect(res.features[0].geometry.type).toBe('Polygon');
    expect(res.features[0].geometry.coordinates[0][0]).toEqual([106.817, -6.201]);
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
    expect(hit.features).toHaveLength(1);

    // Non-overlapping bbox (far away in Tangerang)
    const miss = await controller.getActiveHazards({
      minLat: -6.18,
      minLon: 106.6,
      maxLat: -6.15,
      maxLon: 106.65,
    });
    expect(miss.features).toHaveLength(0);
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
