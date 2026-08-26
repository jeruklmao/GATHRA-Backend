import {
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { validationExceptionFactory } from './common/validation-errors';
import { readConfiguration } from './configuration';

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

  const expressApplication = app.getHttpAdapter().getInstance() as {
    disable?: (setting: string) => void;
  };
  expressApplication.disable?.('x-powered-by');

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
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfiguration);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
  });
}
