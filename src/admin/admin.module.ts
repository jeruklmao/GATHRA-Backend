import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { SensorDeploymentModule } from '../flood/sensors/sensor-deployment.module';
import { IotModule } from '../iot/iot.module';
import { AdminSecurityHeadersMiddleware } from './admin-security-headers.middleware';
import { AdminAuthConfigService } from './auth/admin-auth-config.service';
import { AdminLoginRateLimiter } from './auth/admin-login-rate-limiter';
import { AdminSessionController } from './auth/admin-session.controller';
import { AdminCsrfGuard, AdminSessionGuard } from './auth/admin-session.guard';
import { AdminSessionService } from './auth/admin-session.service';
import { AdminDashboardController } from './dashboard/admin-dashboard.controller';
import { AdminDashboardService } from './dashboard/admin-dashboard.service';
import { AdminHostMetricsService } from './metrics/admin-host-metrics.service';
import { AdminTrafficMiddleware } from './metrics/admin-traffic.middleware';
import { AdminTrafficService } from './metrics/admin-traffic.service';
import { AdminObserverService } from './observer/admin-observer.service';

@Module({
  imports: [IotModule, SensorDeploymentModule],
  controllers: [AdminSessionController, AdminDashboardController],
  providers: [
    AdminAuthConfigService,
    AdminLoginRateLimiter,
    AdminSessionService,
    AdminSessionGuard,
    AdminCsrfGuard,
    AdminTrafficService,
    AdminTrafficMiddleware,
    AdminObserverService,
    AdminHostMetricsService,
    AdminDashboardService,
    AdminSecurityHeadersMiddleware,
  ],
  exports: [AdminTrafficService],
})
export class AdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AdminTrafficMiddleware).forRoutes('*');
    consumer
      .apply(AdminSecurityHeadersMiddleware)
      .forRoutes('/admin', '/admin/*', '/api/v1/admin/session/*', '/api/v1/admin/dashboard/*');
  }
}
