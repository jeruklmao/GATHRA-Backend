import {
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { validationExceptionFactory } from './common/validation-errors';

export function configureApplication(app: INestApplication): void {
  app.enableShutdownHooks();
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
    .setTitle('GATHRA Routing API')
    .setDescription(
      'Backend-owned route previews. The routing provider is intentionally private.',
    )
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfiguration);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
  });
}
