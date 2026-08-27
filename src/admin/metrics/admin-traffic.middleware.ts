import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AdminTrafficService, normalizeHttpRoute } from './admin-traffic.service';

@Injectable()
export class AdminTrafficMiddleware implements NestMiddleware {
  constructor(private readonly traffic: AdminTrafficService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const started = process.hrtime.bigint();
    const requestBytes = boundedHeaderNumber(request.headers['content-length']);
    response.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      this.traffic.record({
        at: new Date(),
        method: safeMethod(request.method),
        route: normalizeHttpRoute(request.path),
        statusCode: response.statusCode,
        latencyMs: durationMs,
        requestBytes,
        responseBytes: boundedHeaderNumber(response.getHeader('content-length')),
      });
    });
    next();
  }
}

function boundedHeaderNumber(value: unknown): number {
  const parsed = Array.isArray(value) ? Number(value[0]) : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function safeMethod(value: string): string {
  const method = value.toUpperCase();
  return ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)
    ? method
    : 'GET';
}
