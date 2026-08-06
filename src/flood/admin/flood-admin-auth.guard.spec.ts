import { createHash } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { ApiException } from '../../common/api-error';
import { FloodAdminAuthGuard } from './flood-admin-auth.guard';

const ADMIN_TOKEN = '0123456789abcdef'.repeat(4);
const ADMIN_TOKEN_DIGEST = createHash('sha256')
  .update(ADMIN_TOKEN, 'utf8')
  .digest();

describe('FloodAdminAuthGuard', () => {
  const guard = new FloodAdminAuthGuard(ADMIN_TOKEN_DIGEST);

  it('accepts the configured bearer token', () => {
    expect(
      guard.canActivate(contextWithAuthorization(`Bearer ${ADMIN_TOKEN}`)),
    ).toBe(true);
    expect(
      guard.canActivate(contextWithAuthorization(`bearer ${ADMIN_TOKEN}`)),
    ).toBe(true);
  });

  it.each([
    ['a missing header', undefined],
    ['a wrong token', `Bearer ${'f'.repeat(64)}`],
    ['a non-hex token', `Bearer ${'z'.repeat(64)}`],
    ['a different scheme', `Basic ${ADMIN_TOKEN}`],
    ['an oversized header', `Bearer ${'a'.repeat(129)}`],
  ])('rejects %s without revealing authentication details', (_label, value) => {
    expect(() => guard.canActivate(contextWithAuthorization(value))).toThrow(
      expect.objectContaining<Partial<ApiException>>({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        retryable: false,
      }),
    );
  });

  it('rejects an invalid configured digest during construction', () => {
    expect(() => new FloodAdminAuthGuard(Buffer.alloc(31))).toThrow(
      'Flood admin token digest must contain 32 bytes',
    );
  });
});

function contextWithAuthorization(
  authorization: string | undefined,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) =>
          name.toLowerCase() === 'authorization' ? authorization : undefined,
      }),
    }),
  } as unknown as ExecutionContext;
}
