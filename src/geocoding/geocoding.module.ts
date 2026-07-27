import { Module } from '@nestjs/common';
import { readConfiguration } from '../configuration';
import { GeocodingController } from './geocoding.controller';
import {
  GEOCODING_PROVIDER,
  type GeocodingProvider,
} from './geocoding-provider';
import { GeocodingService } from './geocoding.service';
import { FakeGeocodingProvider } from './providers/fake-geocoding.provider';
import { PeliasGeocodingProvider } from './providers/pelias-geocoding.provider';
import { GeocodingRateLimitGuard } from './rate-limit/geocoding-rate-limit.guard';
import { SupportedRegion } from './region/supported-region';
import { PlaceTokenCodec } from './security/place-token.codec';

@Module({
  controllers: [GeocodingController],
  providers: [
    GeocodingService,
    SupportedRegion,
    PlaceTokenCodec,
    GeocodingRateLimitGuard,
    FakeGeocodingProvider,
    PeliasGeocodingProvider,
    {
      provide: GEOCODING_PROVIDER,
      useFactory: (
        fakeProvider: FakeGeocodingProvider,
        peliasProvider: PeliasGeocodingProvider,
      ): GeocodingProvider =>
        readConfiguration().geocodingProvider === 'pelias'
          ? peliasProvider
          : fakeProvider,
      inject: [FakeGeocodingProvider, PeliasGeocodingProvider],
    },
  ],
  exports: [GEOCODING_PROVIDER],
})
export class GeocodingModule {}
