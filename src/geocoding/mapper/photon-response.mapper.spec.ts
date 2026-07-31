import { GeocodingProviderError } from '../geocoding-provider';
import {
  GeocodingSource,
  PlaceCategory,
} from '../models/geocoding.models';
import {
  mapPhotonDetails,
  mapPhotonSuggestions,
} from './photon-response.mapper';

describe('Photon response mapper', () => {
  it('maps a provider feature without leaking Photon fields', () => {
    const [suggestion] = mapPhotonSuggestions(
      featureCollection([
        feature({
          osm_type: 'N',
          osm_id: 123,
          name: 'SMA Negeri 35 Jakarta',
          osm_key: 'amenity',
          osm_value: 'school',
          district: 'Karet Tengsin',
          city: 'Jakarta Pusat',
          country: 'Indonesia',
        }),
      ]),
    );

    expect(suggestion).toEqual({
      providerId: 'N:123',
      primaryText: 'SMA Negeri 35 Jakarta',
      secondaryText: 'Karet Tengsin, Jakarta Pusat, Indonesia',
      category: PlaceCategory.SCHOOL,
      position: { latitude: -6.1939, longitude: 106.825 },
      distanceMeters: null,
      source: GeocodingSource.OPENSTREETMAP,
    });
    expect(suggestion).not.toHaveProperty('properties');
  });

  it('maps address, road, hospital, government, transit and neighbourhood categories', () => {
    const categories = [
      [{ housenumber: '35', osm_key: 'building' }, PlaceCategory.ADDRESS],
      [{ osm_key: 'highway', osm_value: 'primary' }, PlaceCategory.ROAD],
      [{ osm_key: 'amenity', osm_value: 'hospital' }, PlaceCategory.HOSPITAL],
      [{ osm_key: 'office', osm_value: 'government' }, PlaceCategory.GOVERNMENT],
      [{ osm_key: 'railway', osm_value: 'station' }, PlaceCategory.TRANSIT],
      [{ osm_key: 'place', osm_value: 'neighbourhood' }, PlaceCategory.NEIGHBOURHOOD],
    ] as const;

    for (const [properties, expected] of categories) {
      const [mapped] = mapPhotonSuggestions(
        featureCollection([
          feature({
            osm_type: 'N',
            osm_id: 1,
            name: 'Uji',
            ...properties,
          }),
        ]),
      );
      expect(mapped.category).toBe(expected);
    }
  });

  it('returns an empty list for a valid empty FeatureCollection', () => {
    expect(mapPhotonSuggestions(featureCollection([]))).toEqual([]);
    expect(mapPhotonDetails(featureCollection([]))).toEqual([]);
  });

  it.each([
    null,
    {},
    { type: 'FeatureCollection', features: 'invalid' },
    featureCollection([{ type: 'Feature', properties: {}, geometry: null }]),
    featureCollection([
      feature({
        osm_type: 'N',
        name: 'Missing ID',
        osm_key: 'amenity',
        osm_value: 'school',
      }),
    ]),
    featureCollection([
      feature({
        osm_type: 'X',
        osm_id: 1,
        name: 'Invalid type',
      }),
    ]),
    featureCollection([
      feature({
        osm_type: 'N',
        osm_id: 1.5,
        name: 'Invalid ID',
      }),
    ]),
    featureCollection([
      feature({
        osm_type: 'N',
        osm_id: 1,
        name: '',
      }),
    ]),
    featureCollection([
      {
        ...feature({ osm_type: 'N', osm_id: 1, name: 'Bad point' }),
        geometry: { type: 'Point', coordinates: [181, -6.2] },
      },
    ]),
  ])('rejects malformed provider payload %#', (payload) => {
    expect(() => mapPhotonSuggestions(payload)).toThrow(
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
