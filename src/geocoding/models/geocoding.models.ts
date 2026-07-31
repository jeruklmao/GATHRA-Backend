export enum PlaceCategory {
  ADDRESS = 'ADDRESS',
  ROAD = 'ROAD',
  SCHOOL = 'SCHOOL',
  HOSPITAL = 'HOSPITAL',
  LANDMARK = 'LANDMARK',
  GOVERNMENT = 'GOVERNMENT',
  TRANSIT = 'TRANSIT',
  NEIGHBOURHOOD = 'NEIGHBOURHOOD',
  OTHER = 'OTHER',
}

export enum GeocodingSource {
  OPENSTREETMAP = 'OPENSTREETMAP',
  GATHRA_CSV = 'GATHRA_CSV',
  OTHER = 'OTHER',
}

export enum GeocodingCoverage {
  INSIDE_SUPPORTED_REGION = 'INSIDE_SUPPORTED_REGION',
  OUTSIDE_SUPPORTED_REGION = 'OUTSIDE_SUPPORTED_REGION',
}

export interface GeocodingPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface ProviderPlaceSuggestion {
  readonly providerId: string;
  readonly primaryText: string;
  readonly secondaryText: string | null;
  readonly category: PlaceCategory | null;
  readonly position: GeocodingPoint | null;
  readonly distanceMeters: number | null;
  readonly source: GeocodingSource;
}

export interface ProviderPlaceDetails {
  readonly providerId: string | null;
  readonly name: string;
  readonly formattedAddress: string | null;
  readonly position: GeocodingPoint;
  readonly category: PlaceCategory | null;
  readonly source: GeocodingSource;
}

export interface PlaceSuggestion {
  readonly id: string;
  readonly primaryText: string;
  readonly secondaryText: string | null;
  readonly category: PlaceCategory | null;
  readonly position: GeocodingPoint | null;
  readonly distanceMeters: number | null;
  readonly insideSupportedRegion: boolean;
}

export interface PlaceDetails {
  readonly id: string | null;
  readonly name: string;
  readonly formattedAddress: string | null;
  readonly position: GeocodingPoint;
  readonly category: PlaceCategory | null;
  readonly insideSupportedRegion: boolean;
}

export interface GeocodingSearchInput {
  readonly query: string;
  readonly proximity: GeocodingPoint;
  readonly limit: number;
  readonly language: string;
}

export interface ReverseGeocodeInput {
  readonly point: GeocodingPoint;
  readonly language: string;
}
