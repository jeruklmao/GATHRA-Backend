import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  type OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';
import { DatabaseService } from '../../database/database.service';
import { AdminAuthConfigService } from './admin-auth-config.service';
import { AdminLoginRateLimiter } from './admin-login-rate-limiter';
import {
  ADMIN_SESSION_COOKIE,
  type AdminSessionContext,
} from './admin-session.models';

interface SessionRow {
  readonly session_token_hash: Buffer;
  readonly csrf_token_hash: Buffer;
  readonly created_at: Date;
  readonly last_seen_at: Date;
  readonly expires_at: Date;
}

export interface CreatedAdminSession extends AdminSessionContext {
  readonly rawSessionToken: string;
}

@Injectable()
export class AdminSessionService implements OnModuleDestroy {
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly database: DatabaseService,
    private readonly configuration: AdminAuthConfigService,
    private readonly limiter: AdminLoginRateLimiter,
  ) {
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpired().catch(() => undefined);
    }, 15 * 60_000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  get idleTimeoutMinutes(): number {
    return this.configuration.idleMinutes;
  }

  assertEnabled(): void {
    if (!this.configuration.enabled) {
      throw new NotFoundException('Resource not found');
    }
  }

  async login(
    username: string,
    password: string,
    request: Request,
    now = new Date(),
  ): Promise<CreatedAdminSession> {
    this.assertEnabled();
    const clientKey = trustedClientKey(request);
    this.limiter.assertAllowed(clientKey, now.getTime());
    const verifier = this.configuration.passwordVerifier!;
    const candidate = await scryptPassword(password, verifier);
    const passwordMatches = timingSafeEqual(candidate, verifier.digest);
    const usernameMatches = constantTimeStringEqual(
      username,
      this.configuration.username,
    );
    if (!passwordMatches || !usernameMatches) {
      this.limiter.recordFailure(clientKey, now.getTime());
      throw new UnauthorizedException('Invalid username or password');
    }
    this.limiter.recordSuccess(clientKey, now.getTime());

    const rawSessionToken = randomBytes(32).toString('base64url');
    const tokenHash = this.tokenHash(rawSessionToken);
    const csrfToken = this.deriveCsrf(rawSessionToken);
    const csrfHash = this.csrfHash(csrfToken);
    const expiresAt = new Date(
      now.getTime() + this.configuration.absoluteMinutes * 60_000,
    );
    await this.database.query(
      `
        INSERT INTO admin_sessions (
          session_token_hash, csrf_token_hash, created_at, last_seen_at, expires_at
        ) VALUES ($1, $2, $3, $3, $4)
      `,
      [tokenHash, csrfHash, now, expiresAt],
    );
    return {
      rawSessionToken,
      tokenHash,
      csrfToken,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    };
  }

  async authenticate(request: Request, now = new Date()): Promise<AdminSessionContext> {
    this.assertEnabled();
    const rawToken = readCookie(request.headers.cookie, ADMIN_SESSION_COOKIE);
    if (rawToken === null || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) {
      throw new UnauthorizedException('Authentication required');
    }
    const tokenHash = this.tokenHash(rawToken);
    const result = await this.database.query<SessionRow>(
      `
        SELECT session_token_hash, csrf_token_hash, created_at, last_seen_at, expires_at
        FROM admin_sessions
        WHERE session_token_hash = $1
      `,
      [tokenHash],
    );
    const row = result.rows[0];
    const idleDeadline =
      row === undefined
        ? 0
        : row.last_seen_at.getTime() + this.configuration.idleMinutes * 60_000;
    if (
      row === undefined ||
      row.expires_at.getTime() <= now.getTime() ||
      idleDeadline <= now.getTime()
    ) {
      if (row !== undefined) {
        await this.database.query(
          'DELETE FROM admin_sessions WHERE session_token_hash = $1',
          [tokenHash],
        );
      }
      throw new UnauthorizedException('Authentication required');
    }
    const csrfToken = this.deriveCsrf(rawToken);
    if (!timingSafeEqual(this.csrfHash(csrfToken), row.csrf_token_hash)) {
      await this.database.query(
        'DELETE FROM admin_sessions WHERE session_token_hash = $1',
        [tokenHash],
      );
      throw new UnauthorizedException('Authentication required');
    }
    if (now.getTime() - row.last_seen_at.getTime() >= 60_000) {
      await this.database.query(
        `UPDATE admin_sessions SET last_seen_at = $2
         WHERE session_token_hash = $1 AND last_seen_at < $2`,
        [tokenHash, now],
      );
    }
    return {
      tokenHash,
      csrfToken,
      createdAt: row.created_at,
      lastSeenAt: now,
      expiresAt: row.expires_at,
    };
  }

  verifyCsrf(context: AdminSessionContext, candidate: unknown): void {
    if (
      typeof candidate !== 'string' ||
      candidate.length !== context.csrfToken.length ||
      !timingSafeEqual(Buffer.from(candidate), Buffer.from(context.csrfToken))
    ) {
      throw new ForbiddenException('CSRF validation failed');
    }
  }

  async logout(tokenHash: Buffer): Promise<void> {
    await this.database.query(
      'DELETE FROM admin_sessions WHERE session_token_hash = $1',
      [tokenHash],
    );
  }

  async cleanupExpired(now = new Date()): Promise<number> {
    const result = await this.database.query(
      `
        DELETE FROM admin_sessions
        WHERE expires_at <= $1
           OR last_seen_at <= $1 - ($2::text || ' minutes')::interval
      `,
      [now, this.configuration.idleMinutes],
    );
    return result.rowCount ?? 0;
  }

  private tokenHash(token: string): Buffer {
    return keyedHash(this.configuration.sessionSecret!, 'session', token);
  }

  private deriveCsrf(token: string): string {
    return keyedHash(this.configuration.sessionSecret!, 'csrf-token', token).toString(
      'base64url',
    );
  }

  private csrfHash(token: string): Buffer {
    return keyedHash(this.configuration.sessionSecret!, 'csrf-verifier', token);
  }
}

function keyedHash(secret: Buffer, domain: string, value: string): Buffer {
  return createHmac('sha256', secret)
    .update(domain)
    .update('\0')
    .update(value)
    .digest();
}

function scryptPassword(
  password: string,
  verifier: NonNullable<AdminAuthConfigService['passwordVerifier']>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      verifier.salt,
      verifier.digest.length,
      {
        N: verifier.cost,
        r: verifier.blockSize,
        p: verifier.parallelization,
        maxmem: 64 * 1024 * 1024,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

function constantTimeStringEqual(candidate: string, expected: string): boolean {
  const candidateDigest = createHmac('sha256', 'gathra-admin-username')
    .update(candidate)
    .digest();
  const expectedDigest = createHmac('sha256', 'gathra-admin-username')
    .update(expected)
    .digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined || header.length > 8_192) return null;
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    if (item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim();
    }
  }
  return null;
}

export function trustedClientKey(request: Request): string {
  const remote = request.socket.remoteAddress ?? 'unknown';
  const isLoopback =
    remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const cloudflare = request.headers['cf-connecting-ip'];
  if (isLoopback && typeof cloudflare === 'string' && isIP(cloudflare) !== 0) {
    return `cf:${cloudflare}`;
  }
  return `socket:${remote.slice(0, 80)}`;
}
