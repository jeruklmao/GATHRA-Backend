import { FakeGeocodingProvider } from './fake-geocoding.provider';

describe('FakeGeocodingProvider', () => {
  const provider = new FakeGeocodingProvider();

  it('supports deterministic aliases and the common Tangerang typo', async () => {
    const results = await provider.search({
      query: 'Tanggerang',
      proximity: { latitude: -6.18, longitude: 106.63 },
      limit: 8,
      language: 'id',
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.map((result) => result.primaryText).join(' ')).toContain(
      'Tangerang',
    );
  });

  it('preserves the exact input point during reverse lookup', async () => {
    const point = { latitude: -6.17681, longitude: 106.63239 };
    const result = await provider.reverse({ point, language: 'id' });

    expect(result?.position).toEqual(point);
  });

  it('returns null when no fixture is close enough', async () => {
    await expect(
      provider.reverse({
        point: { latitude: -6.4, longitude: 106.9 },
        language: 'id',
      }),
    ).resolves.toBeNull();
  });
});
