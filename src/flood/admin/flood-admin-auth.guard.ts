import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../../common/api-error';

export const FLOOD_ADMIN_TOKEN_DIGEST = Symbol(
  'FLOOD_ADMIN_TOKEN_DIGEST',
);

const AUTHORIZATION_PATTERN = /^Bearer ([a-f0-9]{64})$/i;
const MAX_AUTHORIZATION_LENGTH = 128;

@Injectable()
export class FloodAdminAuthGuard implements CanActivate {
  constructor(
    @Inject(FLOOD_ADMIN_TOKEN_DIGEST)
    private readonly expectedDigest: Buffer,
  ) {
    if (expectedDigest.length !== 32) {
      throw new Error('Flood admin token digest must contain 32 bytes');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.header('authorization');
    const token = extractBearerToken(authorization);
    const suppliedDigest = createHash('sha256')
      .update(token ?? '', 'utf8')
      .digest();
    const authenticated =
      token !== null && timingSafeEqual(suppliedDigest, this.expectedDigest);

    if (!authenticated) {
      throw ApiException.authenticationRequired();
    }
    return true;
  }
}

function extractBearerToken(authorization: string | undefined): string | null {
  if (
    authorization === undefined ||
    authorization.length > MAX_AUTHORIZATION_LENGTH
  ) {
    return null;
  }
  return AUTHORIZATION_PATTERN.exec(authorization)?.[1] ?? null;
}
