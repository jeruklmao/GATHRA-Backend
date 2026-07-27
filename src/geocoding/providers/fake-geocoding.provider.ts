import { Injectable } from '@nestjs/common';
import type {
  GeocodingProvider,
} from '../geocoding-provider';
import { GeocodingProviderError } from '../geocoding-provider';
import {
  GeocodingSource,
  PlaceCategory,
  type GeocodingSearchInput,
  type ProviderPlaceDetails,
  type ProviderPlaceSuggestion,
  type ReverseGeocodeInput,
} from '../models/geocoding.models';

interface FakePlace extends ProviderPlaceDetails {
  readonly providerId: string;
  readonly aliases: readonly string[];
}

const PLACES: readonly FakePlace[] = [
  demoPlace(
    'fake:venue:jakarta-pusat',
    'Pusat Belajar GATHRA Jakarta Pusat',
    'Gambir, Jakarta Pusat',
    -6.1767,
    106.8307,
    PlaceCategory.SCHOOL,
    ['sekolah pusat', 'sman pusat'],
  ),
  demoPlace(
    'fake:venue:jakarta-selatan',
    'Klinik Demo GATHRA Jakarta Selatan',
    'Kebayoran Baru, Jakarta Selatan',
    -6.243,
    106.7992,
    PlaceCategory.HOSPITAL,
    ['rumah sakit selatan', 'rs selatan'],
  ),
  demoPlace(
    'fake:venue:kota-tangerang',
    'Balai Layanan Demo Kota Tangerang',
    'Tangerang, Kota Tangerang',
    -6.1783,
    106.6319,
    PlaceCategory.GOVERNMENT,
    ['kantor tangerang', 'tanggerang'],
  ),
  demoPlace(
    'fake:venue:tangerang-selatan',
    'Taman Demo GATHRA Tangerang Selatan',
    'Serpong, Kota Tangerang Selatan',
    -6.3017,
    106.6546,
    PlaceCategory.LANDMARK,
    ['taman tangsel', 'tanggerang selatan'],
  ),
  demoPlace(
    'fake:street:sudirman',
    'Jalan Jenderal Sudirman',
    'Jakarta Pusat',
    -6.2088,
    106.8229,
    PlaceCategory.ROAD,
    ['jl sudirman', 'jend sudirman'],
  ),
  demoPlace(
    'fake:neighbourhood:ciputat',
    'Ciputat',
    'Kota Tangerang Selatan',
    -6.3114,
    106.7489,
    PlaceCategory.NEIGHBOURHOOD,
    ['ciputat tangsel'],
  ),
  demoPlace(
    'fake:transit:tangerang',
    'Stasiun Demo Tangerang',
    'Kota Tangerang',
    -6.1768,
    106.6324,
    PlaceCategory.TRANSIT,
    ['stasiun tanggerang'],
  ),
  demoPlace(
    'fake:venue:outside',
    'Lokasi Demo di Luar Wilayah',
    'Bekasi, Jawa Barat',
    -6.2383,
    107.0,
    PlaceCategory.OTHER,
    ['luar wilayah'],
  ),
];

@Injectable()
export class FakeGeocodingProvider implements GeocodingProvider {
  readonly name = 'fake' as const;

  async autocomplete(
    input: GeocodingSearchInput,
  ): Promise<readonly ProviderPlaceSuggestion[]> {
    return this.find(input, true);
  }

  async search(
    input: GeocodingSearchInput,
  ): Promise<readonly ProviderPlaceSuggestion[]> {
    return this.find(input, false);
  }

  async lookup(providerId: string): Promise<ProviderPlaceDetails> {
    const place = PLACES.find((candidate) => candidate.providerId === providerId);
    if (place === undefined) {
      throw new GeocodingProviderError('NOT_FOUND');
    }
    return withoutAliases(place);
  }

  async reverse(
    input: ReverseGeocodeInput,
  ): Promise<ProviderPlaceDetails | null> {
    const closest = PLACES.map((place) => ({
      place,
      distance: distanceMeters(place.position, input.point),
    })).sort((left, right) => left.distance - right.distance)[0];
    if (closest === undefined || closest.distance > 2_000) {
      return null;
    }
    return {
      ...withoutAliases(closest.place),
      // A reverse label describes the requested point; it must never snap the
      // routing coordinate to the nearby fixture.
      position: input.point,
    };
  }

  async health(): Promise<void> {
    return Promise.resolve();
  }

  private async find(
    input: GeocodingSearchInput,
    prefixOnly: boolean,
  ): Promise<readonly ProviderPlaceSuggestion[]> {
    const query = normalize(input.query);
    return PLACES.map((place) => {
      const terms = [place.name, ...place.aliases].map(normalize);
      const match = terms.some((term) =>
        prefixOnly ? term.startsWith(query) || term.includes(` ${query}`) : term.includes(query),
      );
      return {
        place,
        match,
        distance: distanceMeters(place.position, input.proximity),
      };
    })
      .filter((candidate) => candidate.match)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, input.limit)
      .map(({ place, distance }) => ({
        providerId: place.providerId,
        primaryText: place.name,
        secondaryText: place.formattedAddress,
        category: place.category,
        position: place.position,
        distanceMeters: Math.round(distance),
        source: place.source,
      }));
  }
}

function demoPlace(
  providerId: string,
  name: string,
  formattedAddress: string,
  latitude: number,
  longitude: number,
  category: PlaceCategory,
  aliases: readonly string[],
): FakePlace {
  return {
    providerId,
    name,
    formattedAddress,
    position: { latitude, longitude },
    category,
    aliases,
    source: GeocodingSource.GATHRA_CSV,
  };
}

function withoutAliases(place: FakePlace): ProviderPlaceDetails {
  return {
    providerId: place.providerId,
    name: place.name,
    formattedAddress: place.formattedAddress,
    position: place.position,
    category: place.category,
    source: place.source,
  };
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('id-ID')
    .replace(/\s+/g, ' ')
    .trim();
}

function distanceMeters(
  left: { readonly latitude: number; readonly longitude: number },
  right: { readonly latitude: number; readonly longitude: number },
): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (right.latitude - left.latitude) * radians;
  const longitudeDelta = (right.longitude - left.longitude) * radians;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(left.latitude * radians) *
      Math.cos(right.latitude * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}
