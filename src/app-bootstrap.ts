import {
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { validationExceptionFactory } from './common/validation-errors';
import { readConfiguration } from './configuration';
import express, { type Request, type Response } from 'express';
import path from 'node:path';

export function configureApplication(app: INestApplication): void {
  const configuration = readConfiguration();
  app.enableShutdownHooks();
  app.enableCors({
    origin: [...configuration.iotMonitorAllowedOrigins],
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Accept', 'Content-Type', 'X-Request-Id'],
    credentials: false,
    maxAge: 3_600,
  });
  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'api/v',
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());

  const expressApplication = app.getHttpAdapter().getInstance() as express.Express;
  expressApplication.disable('x-powered-by');

  configureAdminAssets(expressApplication, configuration.adminDashboardEnabled);

  const swaggerConfiguration = new DocumentBuilder()
    .setTitle('GATHRA Backend API')
    .setDescription(
      'Provider-neutral route previews/geocoding plus PostgreSQL-backed raw IoT telemetry. Gateway ingestion is authenticated; monitoring is public and read-only.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'opaque Gateway token',
        description:
          'Required only for Gateway ingestion and compatibility diagnostics.',
      },
      'gatewayBearer',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'opaque flood-administrator token',
        description:
          'Required only for authenticated flood sensor deployment administration.',
      },
      'floodAdminBearer',
    )
    .addCookieAuth('gathra_admin_session', {
      type: 'apiKey',
      in: 'cookie',
      description:
        'Browser-only opaque admin session cookie. State changes additionally require X-CSRF-Token.',
    })
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfiguration);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
  });
}

function configureAdminAssets(
  application: express.Express,
  enabled: boolean,
): void {
  const assets = path.join(process.cwd(), 'dist', 'admin-ui', 'assets');
  const index = path.join(process.cwd(), 'dist', 'admin-ui', 'index.html');
  if (enabled) {
    application.use(
      '/admin/assets',
      express.static(assets, {
        immutable: true,
        maxAge: '1y',
        fallthrough: false,
        setHeaders: (response) => setAdminSecurityHeaders(response),
      }),
    );
  }
  application.get(/^\/admin(?:\/.*)?$/, (request: Request, response: Response) => {
    if (!enabled) {
      response.status(404).json({ statusCode: 404, message: 'Not Found' });
      return;
    }
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    setAdminSecurityHeaders(response);
    response.sendFile(index);
  });
}

function setAdminSecurityHeaders(response: Response): void {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'; form-action 'self'",
  );
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
}
