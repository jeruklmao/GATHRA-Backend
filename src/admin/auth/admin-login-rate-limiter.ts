import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface AttemptState {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
}

const WINDOW_MS = 15 * 60_000;
const CLIENT_FAILURE_LIMIT = 5;
const GLOBAL_FAILURE_LIMIT = 20;
const CLIENT_BLOCK_MS = 15 * 60_000;
const GLOBAL_BLOCK_MS = 30 * 60_000;

@Injectable()
export class AdminLoginRateLimiter {
  private readonly clients = new Map<string, AttemptState>();
  private global: AttemptState = emptyState(0);

  assertAllowed(clientKey: string, now = Date.now()): void {
    this.global = normalize(this.global, now);
    const client = normalize(this.clients.get(clientKey) ?? emptyState(now), now);
    this.clients.set(clientKey, client);
    if (client.blockedUntil > now || this.global.blockedUntil > now) {
      throw new HttpException(
        { statusCode: 429, message: 'Login temporarily unavailable' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  recordFailure(clientKey: string, now = Date.now()): void {
    const client = increment(
      normalize(this.clients.get(clientKey) ?? emptyState(now), now),
      CLIENT_FAILURE_LIMIT,
      CLIENT_BLOCK_MS,
      now,
    );
    this.clients.set(clientKey, client);
    this.global = increment(
      normalize(this.global, now),
      GLOBAL_FAILURE_LIMIT,
      GLOBAL_BLOCK_MS,
      now,
    );
    this.prune(now);
  }

  recordSuccess(clientKey: string, now = Date.now()): void {
    this.clients.delete(clientKey);
    this.global = emptyState(now);
  }

  private prune(now: number): void {
    if (this.clients.size <= 2_000) return;
    for (const [key, state] of this.clients) {
      if (state.blockedUntil <= now && state.windowStartedAt + WINDOW_MS <= now) {
        this.clients.delete(key);
      }
    }
  }
}

function emptyState(now: number): AttemptState {
  return { failures: 0, windowStartedAt: now, blockedUntil: 0 };
}

function normalize(state: AttemptState, now: number): AttemptState {
  if (state.windowStartedAt + WINDOW_MS <= now && state.blockedUntil <= now) {
    return emptyState(now);
  }
  return state;
}

function increment(
  state: AttemptState,
  limit: number,
  blockMs: number,
  now: number,
): AttemptState {
  const failures = state.failures + 1;
  return {
    failures,
    windowStartedAt: state.windowStartedAt,
    blockedUntil: failures >= limit ? Math.max(state.blockedUntil, now + blockMs) : state.blockedUntil,
  };
}
