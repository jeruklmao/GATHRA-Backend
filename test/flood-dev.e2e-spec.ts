import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApplication } from '../src/app-bootstrap';
import { FloodModule } from '../src/flood/flood.module';

describe('flood endpoint registration (integration)', () => {
  const originalEnvironment = {
    enableDevFloodEndpoints: process.env.ENABLE_DEV_FLOOD_ENDPOINTS,
    enableFloodAdminEndpoints: process.env.ENABLE_FLOOD_ADMIN_ENDPOINTS,
    floodAdminTokenSha256: process.env.FLOOD_ADMIN_TOKEN_SHA256,
  };
  let app: INestApplication | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
    restoreEnvironmentValue(
      'ENABLE_DEV_FLOOD_ENDPOINTS',
      originalEnvironment.enableDevFloodEndpoints,
    );
    restoreEnvironmentValue(
      'ENABLE_FLOOD_ADMIN_ENDPOINTS',
      originalEnvironment.enableFloodAdminEndpoints,
    );
    restoreEnvironmentValue(
      'FLOOD_ADMIN_TOKEN_SHA256',
      originalEnvironment.floodAdminTokenSha256,
    );
  });

  it('keeps mutation endpoints unavailable while read-only hazards remain public by default', async () => {
    delete process.env.ENABLE_DEV_FLOOD_ENDPOINTS;
    delete process.env.ENABLE_FLOOD_ADMIN_ENDPOINTS;
    delete process.env.FLOOD_ADMIN_TOKEN_SHA256;
    app = await createFloodApplication();

    await request(app.getHttpServer())
      .get('/api/v1/flood-hazards')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    await request(app.getHttpServer())
      .get('/api/v1/dev/flood-hazards')
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/admin/flood-hazards')
      .expect(404);
  });

  it('registers unauthenticated mutation endpoints only after explicit local opt-in', async () => {
    process.env.ENABLE_DEV_FLOOD_ENDPOINTS = 'true';
    delete process.env.ENABLE_FLOOD_ADMIN_ENDPOINTS;
    delete process.env.FLOOD_ADMIN_TOKEN_SHA256;
    app = await createFloodApplication();

    const response = await request(app.getHttpServer())
      .get('/api/v1/dev/flood-hazards')
      .expect(200);
    expect(response.body).toEqual({ hazards: [] });
  });
});

async function createFloodApplication(): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [FloodModule.register()],
  }).compile();
  const application = module.createNestApplication();
  configureApplication(application);
  await application.init();
  return application;
}

function restoreEnvironmentValue(
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
