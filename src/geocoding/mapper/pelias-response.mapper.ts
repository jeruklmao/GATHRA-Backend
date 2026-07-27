import { GeocodingProviderError } from '../geocoding-provider';
import {
  GeocodingSource,
  PlaceCategory,
  type GeocodingPoint,
  type ProviderPlaceDetails,
  type ProviderPlaceSuggestion,
} from '../models/geocoding.models';

const MAX_FEATURES = 100;
const MAX_TEXT_LENGTH = 1_000;

export function mapPeliasSuggestions(
  payload: unknown,
): ProviderPlaceSuggestion[] {
  return parseFeatures(payload).map((feature) => {
    const common = parseCommon(feature);
    return {
      providerId: common.providerId,
      primaryText: common.name,
      secondaryText: secondaryText(common.name, common.label, feature.properties),
      category: common.category,
      position: common.position,
      distanceMeters: parseDistanceMeters(feature.properties.distance),
      source: common.source,
    };
  });
}

export function mapPeliasDetails(payload: unknown): ProviderPlaceDetails[] {
  return parseFeatures(payload).map((feature) => {
    const common = parseCommon(feature);
    return {
      providerId: common.providerId,
      name: common.name,
      formattedAddress: common.label,
      position: common.position,
      category: common.category,
      source: common.source,
    };
  });
}

interface PeliasFeature {
  readonly properties: Record<string, unknown>;
  readonly geometry: {
    readonly coordinates: readonly [number, number];
  };
}

function parseFeatures(payload: unknown): PeliasFeature[] {
  if (
    !isRecord(payload) ||
    payload.type !== 'FeatureCollection' ||
    !Array.isArray(payload.features) ||
    payload.features.length > MAX_FEATURES
  ) {
    throw new GeocodingProviderError('INVALID_RESPONSE');
  }
  return payload.features.map((feature) => parseFeature(feature));
}

function parseFeature(value: unknown): PeliasFeature {
  if (
    !isRecord(value) ||
    value.type !== 'Feature' ||
    !isRecord(value.properties) ||
    !isRecord(value.geometry) ||
    value.geometry.type !== 'Point' ||
    !Array.isArray(value.geometry.coordinates) ||
    value.geometry.coordinates.length < 2 ||
    !isLongitude(value.geometry.coordinates[0]) ||
    !isLatitude(value.geometry.coordinates[1])
  ) {
    throw new GeocodingProviderError('INVALID_RESPONSE');
  }
  return {
    properties: value.properties,
    geometry: {
      coordinates: [
        value.geometry.coordinates[0],
        value.geometry.coordinates[1],
      ],
    },
  };
}

function parseCommon(feature: PeliasFeature): {
  readonly providerId: string;
  readonly name: string;
  readonly label: string | null;
  readonly category: PlaceCategory;
  readonly position: GeocodingPoint;
  readonly source: GeocodingSource;
} {
  const providerId = requiredText(feature.properties.gid);
  const name = requiredText(feature.properties.name);
  const label = optionalText(feature.properties.label);
  return {
    providerId,
    name,
    label,
    category: mapCategory(feature.properties),
    position: {
      latitude: feature.geometry.coordinates[1],
      longitude: feature.geometry.coordinates[0],
    },
    source: mapSource(providerId),
  };
}

function mapCategory(properties: Record<string, unknown>): PlaceCategory {
  const tokens = [
    optionalText(properties.layer),
    optionalText(properties.source),
    ...parseStringArray(properties.category),
  ]
    .filter((value): value is string => value !== null)
    .join(' ')
    .toLowerCase();

  if (containsAny(tokens, ['school', 'education', 'college', 'university'])) {
    return PlaceCategory.SCHOOL;
  }
  if (
    containsAny(tokens, [
      'hospital',
      'clinic',
      'health',
      'doctor',
      'pharmacy',
    ])
  ) {
    return PlaceCategory.HOSPITAL;
  }
  if (containsAny(tokens, ['government', 'townhall', 'public building'])) {
    return PlaceCategory.GOVERNMENT;
  }
  if (containsAny(tokens, ['transit', 'station', 'airport', 'terminal'])) {
    return PlaceCategory.TRANSIT;
  }
  if (containsAny(tokens, ['street'])) {
    return PlaceCategory.ROAD;
  }
  if (containsAny(tokens, ['address'])) {
    return PlaceCategory.ADDRESS;
  }
  if (
    containsAny(tokens, ['neighbourhood', 'locality', 'borough', 'macrocounty'])
  ) {
    return PlaceCategory.NEIGHBOURHOOD;
  }
  if (containsAny(tokens, ['venue', 'landmark'])) {
    return PlaceCategory.LANDMARK;
  }
  return PlaceCategory.OTHER;
}

function secondaryText(
  name: string,
  label: string | null,
  properties: Record<string, unknown>,
): string | null {
  if (label !== null) {
    const prefix = `${name},`;
    const withoutName = label.startsWith(prefix)
      ? label.slice(prefix.length).trim()
      : label;
    if (withoutName !== name && withoutName.length > 0) {
      return withoutName;
    }
  }
  const hierarchy = [
    properties.neighbourhood,
    properties.locality,
    properties.borough,
    properties.county,
    properties.region,
  ]
    .map(optionalText)
    .filter((value): value is string => value !== null && value !== name);
  return hierarchy.length === 0 ? null : [...new Set(hierarchy)].join(', ');
}

function parseDistanceMeters(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  // Pelias reports feature distance in kilometres.
  return Math.round(value * 1_000);
}

function mapSource(providerId: string): GeocodingSource {
  const source = providerId.split(':', 1)[0];
  switch (source) {
    case 'openstreetmap':
      return GeocodingSource.OPENSTREETMAP;
    case 'whosonfirst':
      return GeocodingSource.WHOSONFIRST;
    case 'csv':
      return GeocodingSource.GATHRA_CSV;
    default:
      return GeocodingSource.OTHER;
  }
}

function requiredText(value: unknown): string {
  const text = optionalText(value);
  if (text === null) {
    throw new GeocodingProviderError('INVALID_RESPONSE');
  }
  return text;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_TEXT_LENGTH
    ? trimmed
    : null;
}

function parseStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(optionalText)
    .filter((item): item is string => item !== null);
}

function containsAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}

function isLongitude(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -180 &&
    value <= 180
  );
}

function isLatitude(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -90 &&
    value <= 90
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
