import { Injectable } from '@nestjs/common';
import { readConfiguration } from '../../configuration';
import type { GeocodingProvider } from '../geocoding-provider';
import { GeocodingProviderError } from '../geocoding-provider';
import {
  mapPhotonDetails,
  mapPhotonSuggestions,
} from '../mapper/photon-response.mapper';
import type {
  GeocodingSearchInput,
  ProviderPlaceDetails,
  ProviderPlaceSuggestion,
  ReverseGeocodeInput,
} from '../models/geocoding.models';
import { SupportedRegion } from '../region/supported-region';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

@Injectable()
export class PhotonGeocodingProvider implements GeocodingProvider {
  readonly name = 'photon' as const;
  private readonly baseUrl = readConfiguration().photonBaseUrl;
  private readonly timeoutMs = readConfiguration().geocodingTimeoutMs;

  constructor(private readonly supportedRegion: SupportedRegion) {}

  async autocomplete(
    input: GeocodingSearchInput,
  ): Promise<readonly ProviderPlaceSuggestion[]> {
    return this.query(input);
  }

  async search(
    input: GeocodingSearchInput,
  ): Promise<readonly ProviderPlaceSuggestion[]> {
    return this.query(input);
  }

  lookup(_providerId: string): Promise<ProviderPlaceDetails> {
    // Photon has no public lookup-by-OSM-ID endpoint. GeocodingService stores a
    // bounded details entry when it issues each opaque suggestion token, so
    // normal lookup remains compatible without exposing Photon or OpenSearch.
    return Promise.reject(new GeocodingProviderError('NOT_FOUND'));
  }

  async reverse(
    input: ReverseGeocodeInput,
  ): Promise<ProviderPlaceDetails | null> {
    const url = new URL('/reverse', `${this.baseUrl}/`);
    url.searchParams.set('lat', String(input.point.latitude));
    url.searchParams.set('lon', String(input.point.longitude));
    url.searchParams.set('limit', '1');
    setPhotonLanguage(url, input.language);

    const places = mapPhotonDetails(await this.fetchJson(url));
    const place = places[0];
    return place === undefined
      ? null
      : {
          ...place,
          // The map-selected coordinate remains authoritative for routing.
          position: input.point,
        };
  }

  async health(): Promise<void> {
    const focus = this.supportedRegion.fallbackFocus();
    const url = new URL('/api', `${this.baseUrl}/`);
    url.searchParams.set('q', 'Jakarta');
    url.searchParams.set('limit', '1');
    url.searchParams.set('lat', String(focus.latitude));
    url.searchParams.set('lon', String(focus.longitude));
    const bounds = this.supportedRegion.bounds();
    url.searchParams.set(
      'bbox',
      `${bounds.minLongitude},${bounds.minLatitude},${bounds.maxLongitude},${bounds.maxLatitude}`,
    );
    mapPhotonSuggestions(await this.fetchJson(url));
  }

  private async query(
    input: GeocodingSearchInput,
  ): Promise<readonly ProviderPlaceSuggestion[]> {
    const suggestions = mapPhotonSuggestions(
      await this.fetchJson(this.searchUrl(input)),
    );
    return suggestions.map((suggestion) => ({
      ...suggestion,
      distanceMeters:
        suggestion.position === null
          ? null
          : Math.round(distanceMeters(input.proximity, suggestion.position)),
    }));
  }

  private searchUrl(input: GeocodingSearchInput): URL {
    const bounds = this.supportedRegion.bounds();
    const url = new URL('/api', `${this.baseUrl}/`);
    url.searchParams.set('q', input.query);
    url.searchParams.set('limit', String(input.limit));
    setPhotonLanguage(url, input.language);
    url.searchParams.set('lat', String(input.proximity.latitude));
    url.searchParams.set('lon', String(input.proximity.longitude));
    url.searchParams.set(
      'bbox',
      `${bounds.minLongitude},${bounds.minLatitude},${bounds.maxLongitude},${bounds.maxLatitude}`,
    );
    return url;
  }

  private async fetchJson(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        redirect: 'error',
      });
      const declaredLength = Number(response.headers.get('content-length'));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_BYTES
      ) {
        throw new GeocodingProviderError('INVALID_RESPONSE');
      }
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new GeocodingProviderError('INVALID_RESPONSE');
      }
      if (!response.ok) {
        throw classifyHttpFailure(response.status);
      }
      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        throw new GeocodingProviderError('INVALID_RESPONSE', { cause: error });
      }
    } catch (error) {
      if (error instanceof GeocodingProviderError) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new GeocodingProviderError('TIMEOUT', { cause: error });
      }
      throw new GeocodingProviderError('UNAVAILABLE', { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

}

function setPhotonLanguage(url: URL, language: string): void {
  const normalized = language.split('-', 1)[0].toLowerCase();
  // The pinned Indonesia database exposes Photon "default" local labels plus
  // en/de/fr analyzers. Omitting lang for Indonesian requests selects those
  // local labels without sending Photon 0.5.0 an unsupported `id` analyzer.
  if (['en', 'de', 'fr'].includes(normalized)) {
    url.searchParams.set('lang', normalized);
  }
}

function distanceMeters(
  left: { readonly latitude: number; readonly longitude: number },
  right: { readonly latitude: number; readonly longitude: number },
): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (right.latitude - left.latitude) * radians;
  const longitudeDelta = (right.longitude - left.longitude) * radians;
  const leftLatitude = left.latitude * radians;
  const rightLatitude = right.latitude * radians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function classifyHttpFailure(status: number): GeocodingProviderError {
  if (status === 404) {
    return new GeocodingProviderError('NOT_FOUND');
  }
  if (status === 408 || status === 504) {
    return new GeocodingProviderError('TIMEOUT');
  }
  if (status >= 500) {
    return new GeocodingProviderError('UNAVAILABLE');
  }
  return new GeocodingProviderError('INVALID_RESPONSE');
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
