import { AdminLoginRateLimiter } from './admin-login-rate-limiter';

describe('AdminLoginRateLimiter', () => {
  it('blocks a client after five failures without revealing account details', () => {
    const limiter = new AdminLoginRateLimiter();
    const now = Date.parse('2026-08-27T00:00:00Z');
    for (let count = 0; count < 5; count += 1) {
      limiter.assertAllowed('client', now);
      limiter.recordFailure('client', now);
    }
    expect(() => limiter.assertAllowed('client', now)).toThrow(
      'Login temporarily unavailable',
    );
    expect(() => limiter.assertAllowed('other', now)).not.toThrow();
  });

  it('releases a client after the bounded backoff window', () => {
    const limiter = new AdminLoginRateLimiter();
    const now = Date.parse('2026-08-27T00:00:00Z');
    for (let count = 0; count < 5; count += 1) {
      limiter.recordFailure('client', now);
    }
    expect(() => limiter.assertAllowed('client', now + 15 * 60_000)).not.toThrow();
  });
});
