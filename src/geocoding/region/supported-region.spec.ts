import { SupportedRegion } from './supported-region';

describe('SupportedRegion', () => {
  const region = new SupportedRegion();

  it('classifies buffered border points and excludes distant points', () => {
    expect(
      region.contains({ latitude: -6.437, longitude: 106.479 }),
    ).toBe(true);
    expect(
      region.contains({ latitude: -6.025, longitude: 106.955 }),
    ).toBe(true);
    expect(region.contains({ latitude: -6.2, longitude: 107.1 })).toBe(false);
  });

  it('exposes the versioned Jakarta-Tangerang fallback focus', () => {
    expect(region.version).toContain('gathra-jakarta-tangerang');
    expect(region.fallbackFocus()).toEqual({
      latitude: -6.2202,
      longitude: 106.7516,
    });
  });
});
