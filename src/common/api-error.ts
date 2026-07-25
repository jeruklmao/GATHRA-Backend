import { HttpStatus } from '@nestjs/common';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'NO_ROUTE'
  | 'ROUTING_RESPONSE_INVALID'
  | 'ROUTING_UNAVAILABLE'
  | 'ROUTING_TIMEOUT'
  | 'INTERNAL_ERROR';

export interface ApiErrorDetail {
  readonly field: string;
  readonly reason: string;
}

export class ApiException extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: ApiErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly details?: readonly ApiErrorDetail[],
  ) {
    super(message);
    this.name = 'ApiException';
  }

  static validation(details: readonly ApiErrorDetail[]): ApiException {
    return new ApiException(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      'The route preview request is invalid.',
      false,
      details,
    );
  }
}
