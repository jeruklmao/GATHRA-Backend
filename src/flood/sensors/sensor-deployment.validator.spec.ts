import { validateSensorDeployment } from './sensor-deployment.validator';

describe('sensor deployment validation', () => {
  it('accepts the production polygon and confirms the sensor lies inside', () => {
    const result = validateSensorDeployment(validDeployment(), 2_000);
    expect(result.coveragePolygon.coordinates[0]).toHaveLength(10);
    expect(result.coveragePolygon.coordinates[0][0]).toEqual(
      result.coveragePolygon.coordinates[0].at(-1),
    );
  });

  it.each([
    ['expectedPollIntervalMinutes', 0],
    ['hysteresisMm', -1],
    ['mediumThresholdMm', -1],
    ['lowMultiplier', -0.01],
    ['mediumMultiplier', 1.01],
    ['highMultiplier', Number.NaN],
    ['blockedMultiplier', Number.POSITIVE_INFINITY],
  ])('rejects invalid %s=%s', (field, value) => {
    expect(() =>
      validateSensorDeployment(
        { ...validDeployment(), [field]: value },
        2_000,
      ),
    ).toThrow();
  });

  it('rejects staleAfterMinutes below the expected poll interval', () => {
    expect(() =>
      validateSensorDeployment(
        { ...validDeployment(), staleAfterMinutes: 9 },
        2_000,
      ),
    ).toThrow(/staleAfterMinutes/);
  });

  it.each([
    { mediumThresholdMm: 300, highThresholdMm: 300 },
    { highThresholdMm: 750, blockedThresholdMm: 750 },
    { mediumThresholdMm: 301, highThresholdMm: 300 },
  ])('rejects reversed or equal thresholds', (overrides) => {
    expect(() =>
      validateSensorDeployment({ ...validDeployment(), ...overrides }, 2_000),
    ).toThrow(/Thresholds/);
  });

  it.each([
    { hysteresisMm: 21 },
    { mediumThresholdMm: 20, highThresholdMm: 25, hysteresisMm: 6 },
    { highThresholdMm: 300, blockedThresholdMm: 305, hysteresisMm: 6 },
  ])('rejects hysteresis that reverses a release boundary', (overrides) => {
    expect(() =>
      validateSensorDeployment({ ...validDeployment(), ...overrides }, 2_000),
    ).toThrow(/hysteresisMm/);
  });

  it.each([
    ['longitude', 181],
    ['longitude', -181],
    ['latitude', 91],
    ['latitude', -91],
  ])('rejects out-of-range %s', (field, value) => {
    expect(() =>
      validateSensorDeployment(
        { ...validDeployment(), [field]: value },
        2_000,
      ),
    ).toThrow();
  });

  it('rejects an unclosed polygon', () => {
    const input = validDeployment();
    expect(() =>
      validateSensorDeployment(
        {
          ...input,
          coveragePolygon: {
            type: 'Polygon',
            coordinates: [input.coveragePolygon.coordinates[0].slice(0, -1)],
          },
        },
        2_000,
      ),
    ).toThrow(/closed/);
  });

  it('rejects a self-intersecting polygon', () => {
    expect(() =>
      validateSensorDeployment(
        {
          ...validDeployment(),
          latitude: 0.5,
          longitude: 0.5,
          coveragePolygon: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 1],
                [0, 1],
                [1, 0],
                [0, 0],
              ],
            ],
          },
        },
        2_000,
      ),
    ).toThrow(/self-intersect/);
  });

  it('rejects a polygon that does not contain the sensor', () => {
    expect(() =>
      validateSensorDeployment(
        {
          ...validDeployment(),
          latitude: 0,
          longitude: 0,
        },
        2_000,
      ),
    ).toThrow(/inside/);
  });
});

function validDeployment() {
  return {
    nodeId: 'GTH-10003BD4BCFC',
    enabled: true,
    latitude: -6.235149042111252,
    longitude: 106.72040149114301,
    coveragePolygon: {
      type: 'Polygon',
      coordinates: [
        [
          [106.71611965436333, -6.226351128635932],
          [106.71981261034283, -6.225321294492612],
          [106.72420026443773, -6.226956949557767],
          [106.72652819598396, -6.228701635702763],
          [106.72479753726269, -6.233754051518433],
          [106.72206744340276, -6.235692513426338],
          [106.72038553309565, -6.240054277377989],
          [106.7154736960056, -6.237437240913189],
          [106.71443772129092, -6.232287997746711],
          [106.71611965436333, -6.226351128635932],
        ],
      ],
    },
    expectedPollIntervalMinutes: 10,
    staleAfterMinutes: 30,
    hysteresisMm: 10,
    mediumThresholdMm: 20,
    highThresholdMm: 300,
    blockedThresholdMm: 750,
    lowMultiplier: 1,
    mediumMultiplier: 0.35,
    highMultiplier: 0.05,
    blockedMultiplier: 0,
    unknownMultiplier: 1,
  };
}
