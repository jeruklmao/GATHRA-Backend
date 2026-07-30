import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApplication } from '../src/app-bootstrap';
import { FloodModule } from '../src/flood/flood.module';

describe('flood endpoint registration (integration)', () => {
  const originalValue = process.env.ENABLE_DEV_FLOOD_ENDPOINTS;
  let app: INestApplication | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
    if (originalValue === undefined) {
      delete process.env.ENABLE_DEV_FLOOD_ENDPOINTS;
    } else {
      process.env.ENABLE_DEV_FLOOD_ENDPOINTS = originalValue;
    }
  });

  it('keeps mutation endpoints unavailable while read-only hazards remain public by default', async () => {
    delete process.env.ENABLE_DEV_FLOOD_ENDPOINTS;
    app = await createFloodApplication();

    await request(app.getHttpServer())
      .get('/api/v1/flood-hazards')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/dev/flood-hazards')
      .expect(404);
  });

  it('registers unauthenticated mutation endpoints only after explicit local opt-in', async () => {
    process.env.ENABLE_DEV_FLOOD_ENDPOINTS = 'true';
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
