import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app-bootstrap';
import { DatabaseService } from '../src/database/database.service';
import { AdminTrafficService } from '../src/admin/metrics/admin-traffic.service';
import { GatewayHeartbeatService } from '../src/iot/services/gateway-heartbeat.service';
import {
  GEOCODING_PROVIDER,
  type GeocodingProvider,
} from '../src/geocoding/geocoding-provider';
import {
  ROUTING_PROVIDER,
  type RoutingProvider,
} from '../src/routes/routing-provider';

const PASSWORD = 'Test-dashboard-passphrase-42!';

describe('production admin dashboard (PostgreSQL integration)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let temporaryDirectory: string;

  beforeAll(async () => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'gathra-admin-auth-'));
    const authFile = path.join(temporaryDirectory, 'admin-auth.env');
    const salt = randomBytes(16);
    const digest = scryptSync(PASSWORD, salt, 32, {
      N: 32_768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    writeFileSync(
      authFile,
      `ADMIN_USERNAME=admin\nADMIN_PASSWORD_VERIFIER=scrypt$32768$8$1$${salt.toString('base64url')}$${digest.toString('base64url')}\nADMIN_SESSION_SECRET=${randomBytes(32).toString('base64url')}\n`,
      { mode: 0o600 },
    );
    chmodSync(authFile, 0o600);
    process.env.ADMIN_DASHBOARD_ENABLED = 'true';
    process.env.ADMIN_AUTH_FILE = authFile;
    process.env.ADMIN_OBSERVER_DIRECTORY = path.join(temporaryDirectory, 'observer');

    const routingProvider = {
      preview: jest.fn(),
      health: jest.fn().mockResolvedValue(undefined),
    } as unknown as RoutingProvider;
    const geocodingProvider = {
      autocomplete: jest.fn(),
      search: jest.fn(),
      lookup: jest.fn(),
      reverse: jest.fn(),
      health: jest.fn().mockResolvedValue(undefined),
    } as unknown as GeocodingProvider;
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ROUTING_PROVIDER)
      .useValue(routingProvider)
      .overrideProvider(GEOCODING_PROVIDER)
      .useValue(geocodingProvider)
      .compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);
  });

  beforeEach(async () => {
    await database.query(
      'TRUNCATE admin_sessions, iot_sensor_state, iot_sensor_deployments, iot_telemetry, iot_nodes, iot_gateways RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
    delete process.env.ADMIN_DASHBOARD_ENABLED;
    delete process.env.ADMIN_AUTH_FILE;
    delete process.env.ADMIN_OBSERVER_DIRECTORY;
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('serves local hashed assets with strict security headers', async () => {
    const page = await request(app.getHttpServer()).get('/admin').expect(200);
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.text).toMatch(/\/admin\/assets\/app\.[a-f0-9]{12}\.js/);
    await request(app.getHttpServer()).get('/admin/nodes/example').expect(200);
  });

  it('supports login, secure session cookies, session authentication, CSRF, and logout', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/session/login')
      .send({ username: 'admin', password: 'wrong-password' })
      .expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/dashboard/overview').expect(401);

    const login = await request(app.getHttpServer())
      .post('/api/v1/admin/session/login')
      .send({ username: 'admin', password: PASSWORD })
      .expect(201);
    const setCookie = login.headers['set-cookie'] as unknown as string[];
    expect(setCookie[0]).toContain('HttpOnly');
    expect(setCookie[0]).toContain('Secure');
    expect(setCookie[0]).toContain('SameSite=Strict');
    expect(setCookie[0]).toContain('Path=/');
    const cookie = setCookie[0].split(';', 1)[0];
    const session = await request(app.getHttpServer())
      .get('/api/v1/admin/session')
      .set('Cookie', cookie)
      .expect(200);
    expect(session.body).toMatchObject({ authenticated: true, username: 'admin' });
    expect(session.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await request(app.getHttpServer())
      .post('/api/v1/admin/dashboard/sensor-deployments/N1/recompute')
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/admin/dashboard/sensor-deployments/N1/recompute')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', 'x'.repeat(43))
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/admin/session/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', session.body.csrfToken)
      .expect(201, { authenticated: false });
    await request(app.getHttpServer())
      .get('/api/v1/admin/session')
      .set('Cookie', cookie)
      .expect(401);
  });

  it('expires idle sessions and removes their server-side record', async () => {
    const authenticated = await login();
    await database.query(
      `UPDATE admin_sessions
       SET created_at = now() - interval '40 minutes',
           last_seen_at = now() - interval '31 minutes'`,
    );
    await request(app.getHttpServer())
      .get('/api/v1/admin/session')
      .set('Cookie', authenticated.cookie)
      .expect(401);
    const sessions = await database.query<{ count: string }>('SELECT count(*)::text AS count FROM admin_sessions');
    expect(sessions.rows[0].count).toBe('0');
  });

  it('protects Gateway monitoring and clearly represents a pre-heartbeat Gateway', async () => {
    await database.query(
      `INSERT INTO iot_gateways (hardware_mac,logical_gateway_id,firmware_version,first_seen_at,last_seen_at)
       VALUES ('AA:BB:CC:DD:EE:FF','GTH-GW-AABBCCDDEEFF','2.1.0',now(),now())`,
    );
    await request(app.getHttpServer()).get('/api/v1/admin/dashboard/gateways').expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/dashboard/events').expect(401);
    const authenticated = await login();
    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/dashboard/gateways')
      .set('Cookie', authenticated.cookie)
      .expect(200);
    expect(list.body.gateways[0]).toMatchObject({
      gatewayId: 'GTH-GW-AABBCCDDEEFF',
      heartbeat: null,
      freshness: { state: 'HEARTBEAT_UNAVAILABLE' },
    });
    expect(await app.get(GatewayHeartbeatService).metrics('GTH-GW-AABBCCDDEEFF', '24h')).toEqual({ range: '24h', maximumPoints: 1000, points: [] });
    await request(app.getHttpServer())
      .get('/api/v1/admin/dashboard/gateways/GTH-GW-AABBCCDDEEFF/metrics?range=24h')
      .set('Cookie', authenticated.cookie)
      .expect(200, { range: '24h', maximumPoints: 1000, points: [] });
  });

  it('reuses transactional flood validation and recompute behind session CSRF', async () => {
    const authenticated = await login();
    const body = deploymentBody();
    const created = await request(app.getHttpServer())
      .put('/api/v1/admin/dashboard/sensor-deployments/N1')
      .set('Cookie', authenticated.cookie)
      .set('X-CSRF-Token', authenticated.csrf)
      .send(body)
      .expect(200);
    expect(created.body.deployment).toMatchObject({
      nodeId: 'N1',
      configVersion: 1,
      mediumMultiplier: 0.35,
      state: { effectiveLevel: 'UNKNOWN' },
    });

    await request(app.getHttpServer())
      .put('/api/v1/admin/dashboard/sensor-deployments/N1')
      .set('Cookie', authenticated.cookie)
      .set('X-CSRF-Token', authenticated.csrf)
      .send({ ...body, mediumThresholdMm: 400, highThresholdMm: 300 })
      .expect(400);

    const updated = await request(app.getHttpServer())
      .put('/api/v1/admin/dashboard/sensor-deployments/N1')
      .set('Cookie', authenticated.cookie)
      .set('X-CSRF-Token', authenticated.csrf)
      .send({ ...body, mediumMultiplier: 0.7, unknownMultiplier: 0.5 })
      .expect(200);
    expect(updated.body.deployment).toMatchObject({
      configVersion: 2,
      mediumMultiplier: 0.7,
      unknownMultiplier: 0.5,
    });
    const recomputed = await request(app.getHttpServer())
      .post('/api/v1/admin/dashboard/sensor-deployments/N1/recompute')
      .set('Cookie', authenticated.cookie)
      .set('X-CSRF-Token', authenticated.csrf)
      .expect(201);
    expect(recomputed.body.current).toMatchObject({
      effectiveLevel: 'UNKNOWN',
      effectiveMultiplier: 0.5,
      configVersion: 2,
    });
  });

  it('has no shell, restart, reboot, truncate, or deletion routes', async () => {
    const authenticated = await login();
    for (const operation of ['shell', 'restart', 'reboot', 'truncate', 'delete-telemetry']) {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/dashboard/${operation}`)
        .set('Cookie', authenticated.cookie)
        .set('X-CSRF-Token', authenticated.csrf)
        .expect(404);
    }
  });

  it('flushes normalized minute traffic metrics without query values or client IPs', async () => {
    const authenticated = await login();
    await request(app.getHttpServer())
      .get('/api/v1/admin/dashboard/nodes?private-query=must-not-persist')
      .set('Cookie', authenticated.cookie)
      .expect(200);
    const metrics = app.get(AdminTrafficService);
    await metrics.flush();
    const rows = await database.query<{
      route: string;
      request_count: string;
      latency_histogram: string[];
    }>(`SELECT route, request_count::text, latency_histogram
        FROM admin_http_metrics_minute
        WHERE route = '/api/v1/admin/dashboard/nodes'`);
    expect(rows.rows).toHaveLength(1);
    expect(Number(rows.rows[0].request_count)).toBeGreaterThan(0);
    expect(rows.rows[0].latency_histogram.map(Number)).toHaveLength(10);
    expect(JSON.stringify(rows.rows)).not.toContain('private-query');
    expect(JSON.stringify(rows.rows)).not.toContain('must-not-persist');
    expect(JSON.stringify(rows.rows)).not.toContain('127.0.0.1');
  });

  it('rate-limits repeated login failures with a generic response', async () => {
    for (let count = 0; count < 5; count += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/admin/session/login')
        .set('CF-Connecting-IP', '203.0.113.40')
        .send({ username: 'admin', password: 'incorrect-password' })
        .expect(401);
    }
    const blocked = await request(app.getHttpServer())
      .post('/api/v1/admin/session/login')
      .set('CF-Connecting-IP', '203.0.113.40')
      .send({ username: 'admin', password: 'incorrect-password' })
      .expect(429);
    expect(JSON.stringify(blocked.body)).not.toContain('admin');
  });

  async function login(): Promise<{ cookie: string; csrf: string }> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/session/login')
      .send({ username: 'admin', password: PASSWORD })
      .expect(201);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    return { cookie: cookies[0].split(';', 1)[0], csrf: response.body.csrfToken };
  }
});

function deploymentBody() {
  return {
    enabled: true,
    latitude: -6.5,
    longitude: 106.5,
    coveragePolygon: {
      type: 'Polygon',
      coordinates: [[[106, -6], [107, -6], [107, -7], [106, -7], [106, -6]]],
    },
    expectedPollIntervalMinutes: 10,
    staleAfterMinutes: 30,
    hysteresisMm: 10,
    mediumThresholdMm: 20,
    highThresholdMm: 300,
    blockedThresholdMm: 750,
    lowMultiplier: 1,
    mediumMultiplier: 0.35,
    highMultiplier: 0.05,
    blockedMultiplier: 0,
    unknownMultiplier: 1,
  };
}
