import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './app-bootstrap';
import { readConfiguration } from './configuration';

async function bootstrap(): Promise<void> {
  const configuration = readConfiguration();
  const app = await NestFactory.create(AppModule);
  configureApplication(app);
  await app.listen(configuration.port, '0.0.0.0');
}

void bootstrap();
