import type { ExecutionContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ApiException } from '../../common/api-error';
import { GatewayAuthGuard } from './gateway-auth.guard';

describe('GatewayAuthGuard', () => {
  const rawToken = 'correct-gateway-token';
  const digest = createHash('sha256').update(rawToken).digest();

  it('rejects a missing Bearer token', () => {
    const guard = new GatewayAuthGuard(digest);
    expect(() => guard.canActivate(context(undefined))).toThrow(ApiException);
  });

  it('rejects a wrong Bearer token', () => {
    const guard = new GatewayAuthGuard(digest);
    expect(() => guard.canActivate(context('Bearer wrong'))).toThrow(
      ApiException,
    );
  });

  it('accepts the exact token whose SHA-256 digest is configured', () => {
    const guard = new GatewayAuthGuard(digest);
    expect(guard.canActivate(context(`Bearer ${rawToken}`))).toBe(true);
  });

  it('fails closed when no valid digest is configured', () => {
    const guard = new GatewayAuthGuard(null);
    expect(() => guard.canActivate(context(`Bearer ${rawToken}`))).toThrow(
      expect.objectContaining({
        status: 503,
        code: 'IOT_INGESTION_UNAVAILABLE',
      }),
    );
  });
});

function context(authorization: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}
