import {
  Controller,
  Get,
  Header,
  HttpStatus,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiGatewayTimeoutResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { requestIdFrom } from '../common/request-context';
import { ApiErrorResponseDto } from '../routes/dto/error-response.dto';
import {
  GeocodingSearchQueryDto,
  PlaceLookupParamsDto,
  ReverseGeocodingQueryDto,
} from './dto/geocoding-request.dto';
import {
  PlaceDetailsDto,
  PlaceSuggestionsResponseDto,
} from './dto/geocoding-response.dto';
import { GeocodingRateLimitGuard } from './rate-limit/geocoding-rate-limit.guard';
import { GeocodingService } from './geocoding.service';

@ApiTags('geocoding')
@UseGuards(GeocodingRateLimitGuard)
@Controller({ path: 'geocoding', version: '1' })
export class GeocodingController {
  constructor(private readonly geocodingService: GeocodingService) {}

  @Get('autocomplete')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Return location-biased place suggestions' })
  @ApiOkResponse({ type: PlaceSuggestionsResponseDto })
  @GeocodingErrorResponses()
  autocomplete(
    @Req() request: Request,
    @Query() query: GeocodingSearchQueryDto,
  ): Promise<PlaceSuggestionsResponseDto> {
    return this.geocodingService.autocomplete(requestIdFrom(request), query);
  }

  @Get('search')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Run an explicit place search' })
  @ApiOkResponse({ type: PlaceSuggestionsResponseDto })
  @GeocodingErrorResponses()
  search(
    @Req() request: Request,
    @Query() query: GeocodingSearchQueryDto,
  ): Promise<PlaceSuggestionsResponseDto> {
    return this.geocodingService.search(requestIdFrom(request), query);
  }

  @Get('places/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Resolve an opaque place token' })
  @ApiOkResponse({ type: PlaceDetailsDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @GeocodingErrorResponses()
  lookup(
    @Req() request: Request,
    @Param() parameters: PlaceLookupParamsDto,
  ): Promise<PlaceDetailsDto> {
    return this.geocodingService.lookup(
      requestIdFrom(request),
      parameters.id,
    );
  }

  @Get('reverse')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Find a display label for an exact selected coordinate',
  })
  @ApiOkResponse({ type: PlaceDetailsDto })
  @ApiNoContentResponse({ description: 'No useful label was found.' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  @GeocodingErrorResponses()
  async reverse(
    @Req() request: Request,
    @Query() query: ReverseGeocodingQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PlaceDetailsDto | null> {
    const result = await this.geocodingService.reverse(
      requestIdFrom(request),
      query,
    );
    if (result === null) {
      response.status(HttpStatus.NO_CONTENT);
    }
    return result;
  }
}

function GeocodingErrorResponses(): MethodDecorator {
  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): void => {
    ApiBadRequestResponse({ type: ApiErrorResponseDto })(
      target,
      propertyKey,
      descriptor,
    );
    ApiBadGatewayResponse({ type: ApiErrorResponseDto })(
      target,
      propertyKey,
      descriptor,
    );
    ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })(
      target,
      propertyKey,
      descriptor,
    );
    ApiGatewayTimeoutResponse({ type: ApiErrorResponseDto })(
      target,
      propertyKey,
      descriptor,
    );
    ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })(
      target,
      propertyKey,
      descriptor,
    );
  };
}
