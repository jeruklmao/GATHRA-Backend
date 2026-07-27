import { GeocodingProviderError } from '../geocoding-provider';
import {
  GeocodingSource,
  PlaceCategory,
} from '../models/geocoding.models';
import {
  mapPeliasDetails,
  mapPeliasSuggestions,
} from './pelias-response.mapper';

describe('Pelias response mapper', () => {
  it('maps a provider feature without leaking Pelias fields', () => {
    const [suggestion] = mapPeliasSuggestions(
      featureCollection([
        feature({
          gid: 'openstreetmap:venue:node/123',
          name: 'SMA Negeri 35 Jakarta',
          label:
            'SMA Negeri 35 Jakarta, Karet Tengsin, Jakarta Pusat, Indonesia',
          layer: 'venue',
          category: ['education', 'school'],
          distance: 1.625,
          locality: 'Jakarta Pusat',
        }),
      ]),
    );

    expect(suggestion).toEqual({
      providerId: 'openstreetmap:venue:node/123',
      primaryText: 'SMA Negeri 35 Jakarta',
      secondaryText: 'Karet Tengsin, Jakarta Pusat, Indonesia',
      category: PlaceCategory.SCHOOL,
      position: { latitude: -6.1939, longitude: 106.825 },
      distanceMeters: 1_625,
      source: GeocodingSource.OPENSTREETMAP,
    });
    expect(suggestion).not.toHaveProperty('properties');
  });

  it('maps address, road, hospital, government, transit and neighbourhood layers', () => {
    const categories = [
      ['address', PlaceCategory.ADDRESS],
      ['street', PlaceCategory.ROAD],
      ['hospital', PlaceCategory.HOSPITAL],
      ['government', PlaceCategory.GOVERNMENT],
      ['transit', PlaceCategory.TRANSIT],
      ['neighbourhood', PlaceCategory.NEIGHBOURHOOD],
    ] as const;

    for (const [layer, expected] of categories) {
      const [mapped] = mapPeliasSuggestions(
        featureCollection([
          feature({
            gid: `openstreetmap:${layer}:node/1`,
            name: 'Uji',
            layer,
          }),
        ]),
      );
      expect(mapped.category).toBe(expected);
    }
  });

  it('returns an empty list for a valid empty FeatureCollection', () => {
    expect(mapPeliasSuggestions(featureCollection([]))).toEqual([]);
    expect(mapPeliasDetails(featureCollection([]))).toEqual([]);
  });

  it.each([
    null,
    {},
    { type: 'FeatureCollection', features: 'invalid' },
    featureCollection([{ type: 'Feature', properties: {}, geometry: null }]),
    featureCollection([
      feature({ gid: '', name: 'Missing ID', layer: 'venue' }),
    ]),
    featureCollection([
      {
        ...feature({ gid: 'openstreetmap:venue:node/1', name: 'Bad point' }),
        geometry: { type: 'Point', coordinates: [181, -6.2] },
      },
    ]),
  ])('rejects malformed provider payload %#', (payload) => {
    expect(() => mapPeliasSuggestions(payload)).toThrow(
      new GeocodingProviderError('INVALID_RESPONSE'),
    );
  });
});

function feature(properties: Record<string, unknown>) {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Point',
      coordinates: [106.825, -6.1939],
    },
  };
}

function featureCollection(features: unknown[]) {
  return { type: 'FeatureCollection', features };
}
