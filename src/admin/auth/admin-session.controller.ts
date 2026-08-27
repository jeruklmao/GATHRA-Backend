import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminCsrfGuard, AdminSessionGuard } from './admin-session.guard';
import {
  ADMIN_SESSION_CONTEXT,
  ADMIN_SESSION_COOKIE,
  type AdminRequest,
  type AdminSessionContext,
} from './admin-session.models';
import { AdminSessionService } from './admin-session.service';

@Controller({ path: 'admin/session', version: '1' })
@ApiTags('Admin dashboard session')
export class AdminSessionController {
  constructor(private readonly sessions: AdminSessionService) {}

  @Post('login')
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() body: AdminLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.sessions.login(
      body.username,
      body.password,
      request,
    );
    response.cookie(ADMIN_SESSION_COOKIE, session.rawSessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      expires: session.expiresAt,
      priority: 'high',
    });
    return sessionResponse(session, this.sessions);
  }

  @Get()
  @UseGuards(AdminSessionGuard)
  @Header('Cache-Control', 'no-store')
  session(@Req() request: AdminRequest) {
    return sessionResponse(requiredContext(request), this.sessions);
  }

  @Post('logout')
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @Header('Cache-Control', 'no-store')
  async logout(
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.sessions.logout(requiredContext(request).tokenHash);
    response.clearCookie(ADMIN_SESSION_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });
    return { authenticated: false };
  }
}

function requiredContext(request: AdminRequest): AdminSessionContext {
  const context = request[ADMIN_SESSION_CONTEXT];
  if (context === undefined) throw new Error('Admin session guard did not run');
  return context;
}

function sessionResponse(
  session: AdminSessionContext,
  service: AdminSessionService,
) {
  return {
    authenticated: true,
    username: 'admin',
    csrfToken: session.csrfToken,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    idleTimeoutMinutes: service.idleTimeoutMinutes,
    timeZone: 'Asia/Jakarta',
  };
}
