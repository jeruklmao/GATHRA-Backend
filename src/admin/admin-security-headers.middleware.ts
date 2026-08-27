import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class AdminSecurityHeadersMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'; form-action 'self'",
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    if (request.path.startsWith('/api/')) {
      response.setHeader('Cache-Control', 'no-store');
    }
    next();
  }
}
