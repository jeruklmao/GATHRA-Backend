import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  REQUEST_ID_HEADER,
  type RequestWithId,
} from './request-context';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const supplied = request.header(REQUEST_ID_HEADER);
    const requestId =
      supplied !== undefined && SAFE_REQUEST_ID.test(supplied)
        ? supplied
        : randomUUID();

    (request as RequestWithId).requestId = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
