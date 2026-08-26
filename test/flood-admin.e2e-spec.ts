import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { configureApplication } from '../src/app-bootstrap';
import { RequestIdMiddleware } from '../src/common/request-id.middleware';
import { FloodModule } from '../src/flood/flood.module';

const ADMIN_TOKEN = '0123456789abcdef'.repeat(4);
const ADMIN_TOKEN_DIGEST = createHash('sha256')
  .update(ADMIN_TOKEN, 'utf8')
  .digest('hex');

describe('authenticated flood administration (integration)', () => {
  const originalEnvironment = {
    enableDevFloodEndpoints: process.env.ENABLE_DEV_FLOOD_ENDPOINTS,
    enableFloodAdminEndpoints: process.env.ENABLE_FLOOD_ADMIN_ENDPOINTS,
    floodAdminTokenSha256: process.env.FLOOD_ADMIN_TOKEN_SHA256,
  };
  let app: INestApplication | null = null;

  beforeEach(async () => {
    delete process.env.ENABLE_DEV_FLOOD_ENDPOINTS;
    process.env.ENABLE_FLOOD_ADMIN_ENDPOINTS = 'true';
    process.env.FLOOD_ADMIN_TOKEN_SHA256 = ADMIN_TOKEN_DIGEST;
    app = await createFloodApplication();
  });

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

  it('rejects missing and incorrect bearer tokens with a generic response', async () => {
    const missing = await supertest(app!.getHttpServer())
      .get('/api/v1/admin/flood-hazards')
      .expect(401)
      .expect('Cache-Control', 'no-store')
      .expect('WWW-Authenticate', 'Bearer realm="gathra-flood-admin"');
    const incorrect = await supertest(app!.getHttpServer())
      .get('/api/v1/admin/flood-hazards')
      .set('Authorization', `Bearer ${'f'.repeat(64)}`)
      .expect(401);

    for (const response of [missing, incorrect]) {
      expect(response.body).toMatchObject({
        requestId: expect.any(String),
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required.',
          retryable: false,
        },
      });
      expect(JSON.stringify(response.body)).not.toContain('token');
    }
  });

  it('shares mutations with the public read endpoint in the same process', async () => {
    await supertest(app!.getHttpServer())
      .get('/api/v1/admin/flood-hazards')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .expect(200, { hazards: [] })
      .expect('Cache-Control', 'no-store');

    const activated = await supertest(app!.getHttpServer())
      .post('/api/v1/admin/flood-hazards/presets/central-corridor-high')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const publicSnapshot = await supertest(app!.getHttpServer())
      .get('/api/v1/flood-hazards')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const adminState = await supertest(app!.getHttpServer())
      .get('/api/v1/admin/flood-hazards')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(activated.body.snapshot.hazards).toHaveLength(2);
    expect(publicSnapshot.body.snapshotId).toBe(
      activated.body.snapshot.snapshotId,
    );
    expect(publicSnapshot.body.features).toHaveLength(2);
    expect(
      publicSnapshot.body.features.every(
        (feature: { properties: { riskLevel: string } }) =>
          feature.properties.riskLevel === 'HIGH',
      ),
    ).toBe(true);
    expect(adminState.body.hazards).toHaveLength(2);
    await supertest(app!.getHttpServer())
      .get('/api/v1/dev/flood-hazards')
      .expect(404);
  });

  it('documents sensor deployment administration while retaining legacy simulation privacy', async () => {
    const docs = await supertest(app!.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    expect(docs.body.paths).toHaveProperty('/api/v1/flood-hazards');
    expect(
      Object.keys(docs.body.paths).filter((path) => path.includes('/admin/')),
    ).toEqual([
      '/api/v1/admin/iot/sensor-deployments',
      '/api/v1/admin/iot/sensor-deployments/{nodeId}',
    ]);
    expect(docs.body.paths).not.toHaveProperty('/api/v1/admin/flood-hazards');
  });
});

async function createFloodApplication(): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [FloodModule.register()],
  }).compile();
  const application = module.createNestApplication();
  const requestIdMiddleware = new RequestIdMiddleware();
  application.use(
    (request: Request, response: Response, next: NextFunction) =>
      requestIdMiddleware.use(request, response, next),
  );
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
