import type { Request } from 'express';

export const ADMIN_SESSION_COOKIE = 'gathra_admin_session';
export const ADMIN_SESSION_CONTEXT = Symbol('ADMIN_SESSION_CONTEXT');

export interface AdminSessionContext {
  readonly tokenHash: Buffer;
  readonly csrfToken: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
}

export type AdminRequest = Request & {
  [ADMIN_SESSION_CONTEXT]?: AdminSessionContext;
};
