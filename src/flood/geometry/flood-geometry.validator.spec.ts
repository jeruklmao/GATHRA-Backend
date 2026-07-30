import {
  validateFloodHazard,
  validateGeoJsonPolygon,
  generateSafeAreaId,
  FloodGeometryValidationError,
} from './flood-geometry.validator';

describe('flood-geometry.validator', () => {
  it('validates a correct FloodHazard object', () => {
    const valid = {
      id: 'hazard-1',
      level: 'HIGH',
      confidence: 0.9,
      observedAt: '2026-07-27T10:00:00Z',
      validUntil: '2026-07-27T12:00:00Z',
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
    };

    const result = validateFloodHazard(valid);
    expect(result.id).toBe('hazard-1');
    expect(result.level).toBe('HIGH');
    expect(result.confidence).toBe(0.9);
  });

  it('rejects invalid ring closure', () => {
    const invalidRing = {
      type: 'Polygon',
      coordinates: [
        [
          [106.8, -6.2],
          [106.81, -6.2],
          [106.81, -6.19],
          [106.8, -6.18], // Not matching first point
        ],
      ],
    };

    expect(() => validateGeoJsonPolygon(invalidRing)).toThrow(
      FloodGeometryValidationError,
    );
  });

  it('rejects out of bound coordinates', () => {
    const invalidCoords = {
      type: 'Polygon',
      coordinates: [
        [
          [190, -6.2], // 190 is out of bounds
          [106.81, -6.2],
          [106.81, -6.19],
          [190, -6.2],
        ],
      ],
    };

    expect(() => validateGeoJsonPolygon(invalidCoords)).toThrow(
      FloodGeometryValidationError,
    );
  });

  it('generates a safe internal area ID', () => {
    const id1 = generateSafeAreaId('hazard-abc');
    const id2 = generateSafeAreaId('hazard-abc');
    expect(id1).toMatch(/^flood_area_[a-f0-9]{12}$/);
    expect(id1).toBe(id2);
  });

  it('honours a configured maximum polygon vertex count', () => {
    const geometry = {
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
    };

    expect(() => validateGeoJsonPolygon(geometry, 4)).toThrow(
      /maximum vertex limit of 4/,
    );
  });
});
