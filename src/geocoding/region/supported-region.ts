import { Injectable } from '@nestjs/common';
import { readConfiguration } from '../../configuration';
import type { GeocodingPoint } from '../models/geocoding.models';

@Injectable()
export class SupportedRegion {
  private readonly region = readConfiguration().geocodingRegion;

  readonly version = this.region.version;

  contains(point: GeocodingPoint): boolean {
    return (
      point.longitude >= this.region.minLongitude &&
      point.longitude <= this.region.maxLongitude &&
      point.latitude >= this.region.minLatitude &&
      point.latitude <= this.region.maxLatitude
    );
  }

  bounds(): Readonly<{
    minLongitude: number;
    minLatitude: number;
    maxLongitude: number;
    maxLatitude: number;
  }> {
    return {
      minLongitude: this.region.minLongitude,
      minLatitude: this.region.minLatitude,
      maxLongitude: this.region.maxLongitude,
      maxLatitude: this.region.maxLatitude,
    };
  }

  fallbackFocus(): GeocodingPoint {
    return {
      latitude: this.region.fallbackLatitude,
      longitude: this.region.fallbackLongitude,
    };
  }
}
