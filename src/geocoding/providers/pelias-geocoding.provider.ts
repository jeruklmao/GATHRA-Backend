import { Injectable } from '@nestjs/common';
import { readConfiguration } from '../../configuration';
import type { GeocodingProvider } from '../geocoding-provider';
import { GeocodingProviderError } from '../geocoding-provider';
import {
  mapPeliasDetails,
  mapPeliasSuggestions,
} from '../mapper/pelias-response.mapper';
import type {
  GeocodingSearchInput,
  ProviderPlaceDetails,
  ProviderPlaceSuggestion,
  ReverseGeocodeInput,
} from '../models/geocoding.models';
import { SupportedRegion } from '../region/supported-region';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

@Injectable()
export class PeliasGeocodingProvider implements GeocodingProvider {
  readonly name = 'pelias' as const;
  private readonly baseUrl = readConfiguration().peliasBaseUrl;
  private readonly timeoutMs = readConfiguration().geocodingTimeoutMs;

  constructor(private readonly supportedRegion: SupportedRegion) {}

  async autocomplete(
    input: GeocodingSearchInput,
  ): Promise<readonly ProviderPlaceSuggestion[]> {
    const url = this.searchUrl('/v1/autocomplete', input);
    return mapPeliasSuggestions(await this.fetchJson(url));
  }

  async search(
    input: GeocodingSearchInput,
  ): Promise<readonly ProviderPlaceSuggestion[]> {
    const url = this.searchUrl('/v1/search', input);
    return mapPeliasSuggestions(await this.fetchJson(url));
  }

  async lookup(providerId: string): Promise<ProviderPlaceDetails> {
    const url = new URL('/v1/place', `${this.baseUrl}/`);
    url.searchParams.set('ids', providerId);
    const places = mapPeliasDetails(await this.fetchJson(url));
    const place = places.find(
      (candidate) => candidate.providerId === providerId,
    );
    if (place === undefined) {
      throw new GeocodingProviderError('NOT_FOUND');
    }
    return place;
  }

  async reverse(
    input: ReverseGeocodeInput,
  ): Promise<ProviderPlaceDetails | null> {
    const url = new URL('/v1/reverse', `${this.baseUrl}/`);
    url.searchParams.set('point.lat', String(input.point.latitude));
    url.searchParams.set('point.lon', String(input.point.longitude));
    url.searchParams.set('size', '1');
    url.searchParams.set('lang', input.language);
    url.searchParams.set('boundary.country', 'IDN');
    const place = mapPeliasDetails(await this.fetchJson(url))[0];
    return place === undefined
      ? null
      : {
          ...place,
          // Pelias may return a nearby POI. Preserve the user's map coordinate
          // and use the provider result solely as display metadata.
          position: input.point,
        };
  }

  async health(): Promise<void> {
    const focus = this.supportedRegion.fallbackFocus();
    const url = new URL('/v1/search', `${this.baseUrl}/`);
    url.searchParams.set('text', 'Jakarta');
    url.searchParams.set('size', '1');
    url.searchParams.set('focus.point.lat', String(focus.latitude));
    url.searchParams.set('focus.point.lon', String(focus.longitude));
    mapPeliasSuggestions(await this.fetchJson(url));
  }

  private searchUrl(
    path: '/v1/autocomplete' | '/v1/search',
    input: GeocodingSearchInput,
  ): URL {
    const bounds = this.supportedRegion.bounds();
    const url = new URL(path, `${this.baseUrl}/`);
    url.searchParams.set('text', input.query);
    url.searchParams.set('size', String(input.limit));
    url.searchParams.set('lang', input.language);
    url.searchParams.set('focus.point.lat', String(input.proximity.latitude));
    url.searchParams.set('focus.point.lon', String(input.proximity.longitude));
    url.searchParams.set('boundary.country', 'IDN');
    url.searchParams.set('boundary.rect.min_lon', String(bounds.minLongitude));
    url.searchParams.set('boundary.rect.min_lat', String(bounds.minLatitude));
    url.searchParams.set('boundary.rect.max_lon', String(bounds.maxLongitude));
    url.searchParams.set('boundary.rect.max_lat', String(bounds.maxLatitude));
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
