import type { Request } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

export interface RequestWithId extends Request {
  requestId: string;
}

export function requestIdFrom(request: Request): string {
  return (request as RequestWithId).requestId;
}
