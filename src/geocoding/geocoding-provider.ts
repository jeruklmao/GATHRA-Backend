import type {
  GeocodingSearchInput,
  ProviderPlaceDetails,
  ProviderPlaceSuggestion,
  ReverseGeocodeInput,
} from './models/geocoding.models';

export const GEOCODING_PROVIDER = Symbol('GEOCODING_PROVIDER');

export interface GeocodingProvider {
  readonly name: 'fake' | 'photon';
  autocomplete(
    input: GeocodingSearchInput,
  ): Promise<readonly ProviderPlaceSuggestion[]>;
  search(
    input: GeocodingSearchInput,
  ): Promise<readonly ProviderPlaceSuggestion[]>;
  lookup(providerId: string): Promise<ProviderPlaceDetails>;
  reverse(input: ReverseGeocodeInput): Promise<ProviderPlaceDetails | null>;
  health(): Promise<void>;
}

export type GeocodingProviderErrorKind =
  | 'NOT_FOUND'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'UNAVAILABLE';

export class GeocodingProviderError extends Error {
  constructor(
    readonly kind: GeocodingProviderErrorKind,
    options?: ErrorOptions,
  ) {
    super(kind, options);
    this.name = 'GeocodingProviderError';
  }
}
