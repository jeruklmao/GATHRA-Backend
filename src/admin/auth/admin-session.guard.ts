import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { AdminSessionService } from './admin-session.service';
import {
  ADMIN_SESSION_CONTEXT,
  type AdminRequest,
} from './admin-session.models';

@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(private readonly sessions: AdminSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    request[ADMIN_SESSION_CONTEXT] = await this.sessions.authenticate(request);
    return true;
  }
}

@Injectable()
export class AdminCsrfGuard implements CanActivate {
  constructor(private readonly sessions: AdminSessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const session = request[ADMIN_SESSION_CONTEXT];
    if (session === undefined) return false;
    this.sessions.verifyCsrf(session, request.headers['x-csrf-token']);
    return true;
  }
}
