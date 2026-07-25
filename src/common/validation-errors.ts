import type { ValidationError } from 'class-validator';
import { ApiException, type ApiErrorDetail } from './api-error';

export function validationExceptionFactory(
  errors: ValidationError[],
): ApiException {
  const details = errors.flatMap((error) => flattenValidationError(error));
  return ApiException.validation(
    details.length > 0
      ? details
      : [{ field: 'request', reason: 'must be a valid JSON request body' }],
  );
}

function flattenValidationError(
  error: ValidationError,
  parentPath = '',
): ApiErrorDetail[] {
  const path = parentPath
    ? `${parentPath}.${error.property}`
    : error.property || 'request';
  const ownErrors = Object.values(error.constraints ?? {}).map((reason) => ({
    field: path,
    reason,
  }));
  const childErrors = (error.children ?? []).flatMap((child) =>
    flattenValidationError(child, path),
  );
  return [...ownErrors, ...childErrors];
}
