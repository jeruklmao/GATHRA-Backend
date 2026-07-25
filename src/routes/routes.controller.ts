import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiGatewayTimeoutResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { requestIdFrom } from '../common/request-context';
import { ApiErrorResponseDto } from './dto/error-response.dto';
import { RoutePreviewRequestDto } from './dto/route-preview-request.dto';
import { RoutePreviewResponseDto } from './dto/route-preview-response.dto';
import { RoutesService } from './routes.service';

@ApiTags('routes')
@Controller({ path: 'routes', version: '1' })
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Calculate one recommended route and an optional alternative',
  })
  @ApiOkResponse({ type: RoutePreviewResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  @ApiBadGatewayResponse({ type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  @ApiGatewayTimeoutResponse({ type: ApiErrorResponseDto })
  preview(
    @Req() request: Request,
    @Body() body: RoutePreviewRequestDto,
  ): Promise<RoutePreviewResponseDto> {
    return this.routesService.preview(requestIdFrom(request), body);
  }
}
