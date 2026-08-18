import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { ApiException } from '../../common/api-error';

export const IOT_GATEWAY_TOKEN_DIGEST = Symbol('IOT_GATEWAY_TOKEN_DIGEST');

@Injectable()
export class GatewayAuthGuard implements CanActivate {
  constructor(
    @Inject(IOT_GATEWAY_TOKEN_DIGEST)
    private readonly configuredDigest: Buffer | null,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.configuredDigest === null) {
      throw new ApiException(
        503,
        'IOT_INGESTION_UNAVAILABLE',
        'Gateway ingestion is unavailable.',
        true,
      );
    }
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.headers.authorization;
    const match =
      typeof authorization === 'string'
        ? /^Bearer ([^\s]{1,512})$/.exec(authorization)
        : null;
    if (match === null) {
      throw ApiException.authenticationRequired();
    }
    const presented = createHash('sha256').update(match[1], 'utf8').digest();
    if (
      presented.length !== this.configuredDigest.length ||
      !timingSafeEqual(presented, this.configuredDigest)
    ) {
      throw ApiException.authenticationRequired();
    }
    return true;
  }
}
