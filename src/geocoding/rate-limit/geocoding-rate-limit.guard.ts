import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../../common/api-error';
import { readConfiguration } from '../../configuration';

interface RateBucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class GeocodingRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, RateBucket>();
  private readonly limit = readConfiguration().geocodingRateLimit;
  private readonly windowMs = readConfiguration().geocodingRateWindowMs;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    let bucket = this.buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= now) {
      this.prune(now);
      while (this.buckets.size >= 10_000) {
        const oldest = this.buckets.keys().next().value as string | undefined;
        if (oldest === undefined) {
          break;
        }
        this.buckets.delete(oldest);
      }
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > this.limit) {
      throw new ApiException(
        429,
        'GEOCODING_RATE_LIMITED',
        'Too many geocoding requests. Please try again shortly.',
        true,
      );
    }
    return true;
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
