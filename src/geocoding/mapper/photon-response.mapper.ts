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

export function mapPhotonSuggestions(
  payload: unknown,
): ProviderPlaceSuggestion[] {
  return parseFeatures(payload).map((feature) => {
    const common = parseCommon(feature);
    return {
      providerId: common.providerId,
      primaryText: common.name,
      secondaryText: secondaryText(common.name, feature.properties),
      category: common.category,
      position: common.position,
      distanceMeters: null,
      source: common.source,
    };
  });
}

export function mapPhotonDetails(payload: unknown): ProviderPlaceDetails[] {
  return parseFeatures(payload).map((feature) => {
    const common = parseCommon(feature);
    return {
      providerId: common.providerId,
      name: common.name,
      formattedAddress: secondaryText(common.name, feature.properties),
      position: common.position,
      category: common.category,
      source: common.source,
    };
  });
}

interface PhotonFeature {
  readonly properties: Record<string, unknown>;
  readonly geometry: {
    readonly coordinates: readonly [number, number];
  };
}

function parseFeatures(payload: unknown): PhotonFeature[] {
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

function parseFeature(value: unknown): PhotonFeature {
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

function parseCommon(feature: PhotonFeature): {
  readonly providerId: string;
  readonly name: string;
  readonly category: PlaceCategory;
  readonly position: GeocodingPoint;
  readonly source: GeocodingSource;
} {
  const type =
    optionalText(feature.properties.osm_type)?.toUpperCase() ?? null;
  const id = positiveSafeInteger(feature.properties.osm_id);
  const name =
    optionalText(feature.properties.name) ||
    optionalText(feature.properties.street) ||
    optionalText(feature.properties.city);
  if (
    type === null ||
    !['N', 'W', 'R'].includes(type) ||
    id === null ||
    name === null
  ) {
    throw new GeocodingProviderError('INVALID_RESPONSE');
  }

  return {
    providerId: `${type}:${id}`,
    name,
    category: mapCategory(feature.properties),
    position: {
      latitude: feature.geometry.coordinates[1],
      longitude: feature.geometry.coordinates[0],
    },
    source: GeocodingSource.OPENSTREETMAP,
  };
}

function mapCategory(properties: Record<string, unknown>): PlaceCategory {
  const osmKey = optionalText(properties.osm_key)?.toLowerCase() || '';
  const osmValue = optionalText(properties.osm_value)?.toLowerCase() || '';
  const combined = `${osmKey} ${osmValue}`;

  if (
    combined.includes('school') ||
    combined.includes('college') ||
    combined.includes('university')
  ) {
    return PlaceCategory.SCHOOL;
  }
  if (
    combined.includes('hospital') ||
    combined.includes('clinic') ||
    combined.includes('pharmacy')
  ) {
    return PlaceCategory.HOSPITAL;
  }
  if (combined.includes('government') || combined.includes('townhall')) {
    return PlaceCategory.GOVERNMENT;
  }
  if (
    combined.includes('station') ||
    combined.includes('airport') ||
    combined.includes('terminal')
  ) {
    return PlaceCategory.TRANSIT;
  }
  if (osmKey === 'highway') {
    return PlaceCategory.ROAD;
  }
  if (osmKey === 'place') {
    return PlaceCategory.NEIGHBOURHOOD;
  }
  if (osmKey === 'historic' || osmKey === 'tourism' || combined.includes('landmark')) {
    return PlaceCategory.LANDMARK;
  }
  if (optionalText(properties.housenumber) !== null) {
    return PlaceCategory.ADDRESS;
  }

  return PlaceCategory.OTHER;
}

function secondaryText(
  name: string,
  properties: Record<string, unknown>,
): string | null {
  const parts = [
    optionalText(properties.housenumber) === null
      ? properties.street
      : `${optionalText(properties.street) ?? ''} ${
          optionalText(properties.housenumber) ?? ''
        }`.trim(),
    properties.district ?? properties.locality,
    properties.city ?? properties.county,
    properties.state,
    properties.country,
  ]
    .map(optionalText)
    .filter((value): value is string => value !== null && value !== name);

  return parts.length === 0 ? null : [...new Set(parts)].join(', ');
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

function positiveSafeInteger(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[0-9]+$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
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
