import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiException,
  type ApiErrorCode,
  type ApiErrorDetail,
} from './api-error';
import { requestIdFrom } from './request-context';

interface ErrorBody {
  readonly requestId: string;
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly details?: readonly ApiErrorDetail[];
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const normalized = normalizeException(exception);
    const body: ErrorBody = {
      requestId: requestIdFrom(request),
      error: {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
        ...(normalized.details === undefined
          ? {}
          : { details: normalized.details }),
      },
    };

    response
      .status(normalized.status)
      .setHeader('Cache-Control', 'no-store')
      .json(body);
  }
}

function normalizeException(exception: unknown): ApiException {
  if (exception instanceof ApiException) {
    return exception;
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status === HttpStatus.BAD_REQUEST) {
      return ApiException.validation([
        {
          field: 'request',
          reason: 'must contain a valid JSON request body',
        },
      ]);
    }
    if (status === HttpStatus.NOT_FOUND) {
      return new ApiException(
        status,
        'NOT_FOUND',
        'The requested resource was not found.',
        false,
      );
    }
    if (status === HttpStatus.METHOD_NOT_ALLOWED) {
      return new ApiException(
        status,
        'METHOD_NOT_ALLOWED',
        'The HTTP method is not supported for this resource.',
        false,
      );
    }
  }

  return new ApiException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    'An unexpected error occurred.',
    true,
  );
}
