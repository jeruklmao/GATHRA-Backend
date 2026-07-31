import { Module } from '@nestjs/common';
import { readConfiguration } from '../configuration';
import { GeocodingController } from './geocoding.controller';
import {
  GEOCODING_PROVIDER,
  type GeocodingProvider,
} from './geocoding-provider';
import { GeocodingService } from './geocoding.service';
import { FakeGeocodingProvider } from './providers/fake-geocoding.provider';
import { PhotonGeocodingProvider } from './providers/photon-geocoding.provider';
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
    PhotonGeocodingProvider,
    {
      provide: GEOCODING_PROVIDER,
      useFactory: (
        fakeProvider: FakeGeocodingProvider,
        photonProvider: PhotonGeocodingProvider,
      ): GeocodingProvider =>
        readConfiguration().geocodingProvider === 'photon'
          ? photonProvider
          : fakeProvider,
      inject: [FakeGeocodingProvider, PhotonGeocodingProvider],
    },
  ],
  exports: [GEOCODING_PROVIDER],
})
export class GeocodingModule {}
