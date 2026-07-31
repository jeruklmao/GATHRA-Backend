import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/api-error';
import { readConfiguration } from '../configuration';
import { BoundedTtlCache } from './cache/bounded-ttl-cache';
import { ConcurrencyLimiter } from './concurrency/concurrency-limiter';
import type {
  GeocodingSearchQueryDto,
  ReverseGeocodingQueryDto,
} from './dto/geocoding-request.dto';
import type {
  PlaceDetailsDto,
  PlaceSuggestionsResponseDto,
} from './dto/geocoding-response.dto';
import {
  GEOCODING_PROVIDER,
  type GeocodingProvider,
  GeocodingProviderError,
} from './geocoding-provider';
import type {
  GeocodingPoint,
  GeocodingSearchInput,
  PlaceDetails,
  PlaceSuggestion,
  ProviderPlaceDetails,
  ProviderPlaceSuggestion,
} from './models/geocoding.models';
import { SupportedRegion } from './region/supported-region';
import { PlaceTokenCodec } from './security/place-token.codec';

const MAX_QUERY_LENGTH = 120;
const MAX_LANGUAGE_LENGTH = 12;
const DEFAULT_AUTOCOMPLETE_LIMIT = 6;
const DEFAULT_SEARCH_LIMIT = 8;
const MAX_LIMIT = 8;

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly configuration = readConfiguration();
  private readonly cache = new BoundedTtlCache<unknown>(
    this.configuration.geocodingCacheEntries,
  );
  private readonly limiter = new ConcurrencyLimiter(
    this.configuration.geocodingMaxConcurrency,
    this.configuration.geocodingMaxQueueSize,
  );

  constructor(
    @Inject(GEOCODING_PROVIDER)
    private readonly provider: GeocodingProvider,
    private readonly supportedRegion: SupportedRegion,
    private readonly tokenCodec: PlaceTokenCodec,
  ) {}

  autocomplete(
    requestId: string,
    query: GeocodingSearchQueryDto,
  ): Promise<PlaceSuggestionsResponseDto> {
    return this.query(
      'autocomplete',
      requestId,
      query,
      DEFAULT_AUTOCOMPLETE_LIMIT,
    );
  }

  search(
    requestId: string,
    query: GeocodingSearchQueryDto,
  ): Promise<PlaceSuggestionsResponseDto> {
    return this.query('search', requestId, query, DEFAULT_SEARCH_LIMIT);
  }

  async lookup(requestId: string, tokenValue: unknown): Promise<PlaceDetailsDto> {
    const startedAt = Date.now();
    if (typeof tokenValue !== 'string') {
      throw placeNotFound();
    }
    const token = this.tokenCodec.decode(tokenValue);
    if (token === null || token.provider !== this.provider.name) {
      throw placeNotFound();
    }
    const cacheKey = digest(`lookup|${tokenValue}`);
    const cached = this.cache.get(cacheKey) as PlaceDetails | undefined;
    if (cached !== undefined) {
      this.logOperation('lookup', requestId, startedAt, 1, true);
      return cached;
    }

    try {
      const place = await this.limiter.run(() =>
        this.provider.lookup(token.id),
      );
      const mapped = this.mapDetails(place);
      this.cache.set(
        cacheKey,
        mapped,
        this.configuration.geocodingReverseCacheTtlMs,
      );
      this.logOperation('lookup', requestId, startedAt, 1, false);
      return mapped;
    } catch (error) {
      throw mapProviderError(error);
    }
  }

  async reverse(
    requestId: string,
    query: ReverseGeocodingQueryDto,
  ): Promise<PlaceDetailsDto | null> {
    const startedAt = Date.now();
    const point = parseRequiredPoint(query.lat, query.lon);
    if (!this.supportedRegion.contains(point)) {
      throw new ApiException(
        422,
        'OUTSIDE_SUPPORTED_REGION',
        'The selected point is outside the supported GATHRA region.',
        false,
      );
    }
    const language = parseLanguage(query.language);
    const cacheKey = digest(
      `reverse|${round(point.latitude, 5)}|${round(point.longitude, 5)}|${language}|${this.supportedRegion.version}`,
    );
    const cached = this.cache.get(cacheKey) as
      | PlaceDetails
      | { readonly empty: true }
      | undefined;
    if (cached !== undefined) {
      const result =
        'empty' in cached ? null : { ...cached, position: point };
      this.logOperation('reverse', requestId, startedAt, result === null ? 0 : 1, true);
      return result;
    }

    try {
      const place = await this.limiter.run(() =>
        this.provider.reverse({ point, language }),
      );
      if (place === null) {
        this.cache.set(
          cacheKey,
          { empty: true },
          this.configuration.geocodingReverseCacheTtlMs,
        );
        this.logOperation('reverse', requestId, startedAt, 0, false);
        return null;
      }
      const mapped = this.mapDetails({ ...place, position: point });
      this.cache.set(
        cacheKey,
        mapped,
        this.configuration.geocodingReverseCacheTtlMs,
      );
      this.logOperation('reverse', requestId, startedAt, 1, false);
      return mapped;
    } catch (error) {
      throw mapProviderError(error);
    }
  }

  private async query(
    operation: 'autocomplete' | 'search',
    requestId: string,
    raw: GeocodingSearchQueryDto,
    defaultLimit: number,
  ): Promise<PlaceSuggestionsResponseDto> {
    const startedAt = Date.now();
    const query = parseQuery(raw.q);
    const proximity = parseOptionalPoint(raw.lat, raw.lon)
      ?? this.supportedRegion.fallbackFocus();
    const limit = parseLimit(raw.limit, defaultLimit);
    const language = parseLanguage(raw.language);
    parseTargetField(raw.forField);
    const input: GeocodingSearchInput = {
      query,
      proximity,
      limit,
      language,
    };
    const canonical = [
      operation,
      normalizeQuery(query),
      round(proximity.latitude, 3),
      round(proximity.longitude, 3),
      limit,
      language,
      this.supportedRegion.version,
    ].join('|');
    const cacheKey = digest(canonical);
    const cached = this.cache.get(cacheKey) as
      | readonly PlaceSuggestion[]
      | undefined;
    if (cached !== undefined) {
      cached.forEach((suggestion) => this.cacheSuggestionLookup(suggestion));
      this.logOperation(operation, requestId, startedAt, cached.length, true, query.length);
      return { suggestions: [...cached], requestId };
    }

    try {
      const providerResults = await this.limiter.run(() =>
        operation === 'autocomplete'
          ? this.provider.autocomplete(input)
          : this.provider.search(input),
      );
      const suggestions = providerResults
        .slice(0, limit)
        .map((result) => this.mapSuggestion(result));
      this.cache.set(
        cacheKey,
        suggestions,
        this.configuration.geocodingCacheTtlMs,
      );
      this.logOperation(
        operation,
        requestId,
        startedAt,
        suggestions.length,
        false,
        query.length,
      );
      return { suggestions, requestId };
    } catch (error) {
      throw mapProviderError(error);
    }
  }

  private mapSuggestion(
    suggestion: ProviderPlaceSuggestion,
  ): PlaceSuggestion {
    try {
      const id = this.tokenCodec.encode(
        this.provider.name,
        suggestion.providerId,
      );
      const insideSupportedRegion =
        suggestion.position !== null &&
        this.supportedRegion.contains(suggestion.position);
      const mapped = {
        id,
        primaryText: suggestion.primaryText,
        secondaryText: suggestion.secondaryText,
        category: suggestion.category,
        position: suggestion.position,
        distanceMeters: suggestion.distanceMeters,
        insideSupportedRegion,
      };
      this.cacheSuggestionLookup(mapped);
      return mapped;
    } catch (error) {
      throw new GeocodingProviderError('INVALID_RESPONSE', { cause: error });
    }
  }

  private mapDetails(details: ProviderPlaceDetails): PlaceDetails {
    try {
      return {
        id:
          details.providerId === null
            ? null
            : this.tokenCodec.encode(this.provider.name, details.providerId),
        name: details.name,
        formattedAddress: details.formattedAddress,
        position: details.position,
        category: details.category,
        insideSupportedRegion: this.supportedRegion.contains(details.position),
      };
    } catch (error) {
      throw new GeocodingProviderError('INVALID_RESPONSE', { cause: error });
    }
  }

  private cacheSuggestionLookup(suggestion: PlaceSuggestion): void {
    if (suggestion.position === null) {
      return;
    }
    // Photon deliberately exposes no lookup-by-OSM-ID endpoint. Cache the
    // normalized details at token issuance so Android's existing
    // search -> place lookup flow remains provider-neutral and unchanged.
    this.cache.set(
      digest(`lookup|${suggestion.id}`),
      {
        id: suggestion.id,
        name: suggestion.primaryText,
        formattedAddress: suggestion.secondaryText,
        position: suggestion.position,
        category: suggestion.category,
        insideSupportedRegion: suggestion.insideSupportedRegion,
      } satisfies PlaceDetails,
      this.configuration.geocodingReverseCacheTtlMs,
    );
  }

  private logOperation(
    operation: string,
    requestId: string,
    startedAt: number,
    resultCount: number,
    cacheHit: boolean,
    queryLength?: number,
  ): void {
    this.logger.log({
      event: 'geocoding_request',
      operation,
      requestId,
      durationMs: Date.now() - startedAt,
      resultCount,
      cacheHit,
      ...(queryLength === undefined ? {} : { queryLength }),
      // Deliberately never include the query or returned address text.
    });
  }
}

function parseQuery(value: unknown): string {
  if (typeof value !== 'string') {
    throw invalidQuery('q', 'must be a string');
  }
  const query = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (/[\p{Cc}\p{Cf}]/u.test(query)) {
    throw invalidQuery('q', 'must not contain control characters');
  }
  if (query.length < 2) {
    throw invalidQuery('q', 'must contain at least 2 characters');
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw invalidQuery(
      'q',
      `must contain no more than ${MAX_QUERY_LENGTH} characters`,
    );
  }
  return query;
}

function normalizeQuery(value: string): string {
  return value.toLocaleLowerCase('id-ID');
}

function parseOptionalPoint(
  latitude: unknown,
  longitude: unknown,
): GeocodingPoint | null {
  if (latitude === undefined && longitude === undefined) {
    return null;
  }
  return parseRequiredPoint(latitude, longitude);
}

function parseRequiredPoint(
  latitude: unknown,
  longitude: unknown,
): GeocodingPoint {
  const parsedLatitude = parseCoordinate(latitude, -90, 90);
  const parsedLongitude = parseCoordinate(longitude, -180, 180);
  if (parsedLatitude === null || parsedLongitude === null) {
    throw new ApiException(
      400,
      'INVALID_COORDINATES',
      'Latitude and longitude must be valid numeric coordinates.',
      false,
    );
  }
  return { latitude: parsedLatitude, longitude: parsedLongitude };
}

function parseCoordinate(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    !/^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

function parseLimit(value: unknown, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw invalidQuery('limit', `must be an integer from 1 to ${MAX_LIMIT}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw invalidQuery('limit', `must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return parsed;
}

function parseLanguage(value: unknown): string {
  if (value === undefined) {
    return 'id';
  }
  if (
    typeof value !== 'string' ||
    value.length > MAX_LANGUAGE_LENGTH ||
    !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value)
  ) {
    throw invalidQuery('language', 'must be a valid language tag');
  }
  return value;
}

function parseTargetField(value: unknown): void {
  if (
    value !== undefined &&
    value !== 'ORIGIN' &&
    value !== 'DESTINATION'
  ) {
    throw invalidQuery('forField', 'must be ORIGIN or DESTINATION');
  }
}

function invalidQuery(field: string, reason: string): ApiException {
  return new ApiException(
    400,
    'INVALID_QUERY',
    'The geocoding query is invalid.',
    false,
    [{ field, reason }],
  );
}

function placeNotFound(): ApiException {
  return new ApiException(
    404,
    'PLACE_NOT_FOUND',
    'The requested place was not found.',
    false,
  );
}

function mapProviderError(error: unknown): ApiException {
  if (!(error instanceof GeocodingProviderError)) {
    return new ApiException(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred.',
      true,
    );
  }
  switch (error.kind) {
    case 'NOT_FOUND':
      return placeNotFound();
    case 'TIMEOUT':
      return new ApiException(
        504,
        'GEOCODER_TIMEOUT',
        'The geocoding service did not respond in time.',
        true,
      );
    case 'INVALID_RESPONSE':
      return new ApiException(
        502,
        'INVALID_PROVIDER_RESPONSE',
        'The geocoding service returned an invalid response.',
        true,
      );
    case 'UNAVAILABLE':
      return new ApiException(
        503,
        'GEOCODER_UNAVAILABLE',
        'The geocoding service is temporarily unavailable.',
        true,
      );
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function round(value: number, digits: number): string {
  return value.toFixed(digits);
}
