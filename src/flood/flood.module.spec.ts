import { FloodAdminController } from './admin/flood-admin.controller';
import { SensorDeploymentAdminController } from './admin/sensor-deployment-admin.controller';
import { DevFloodController } from './dev/dev-flood.controller';
import { FloodController } from './flood.controller';
import { FLOOD_HAZARD_PROVIDER } from './flood-hazard.provider';
import { FloodModule } from './flood.module';
import { SensorFloodHazardProvider } from './providers/sensor-flood-hazard.provider';

describe('FloodModule', () => {
  const originalEnvironment = {
    enableDevFloodEndpoints: process.env.ENABLE_DEV_FLOOD_ENDPOINTS,
    enableFloodAdminEndpoints: process.env.ENABLE_FLOOD_ADMIN_ENDPOINTS,
    floodAdminTokenSha256: process.env.FLOOD_ADMIN_TOKEN_SHA256,
    floodProvider: process.env.FLOOD_PROVIDER,
    nodeEnvironment: process.env.NODE_ENV,
  };

  afterEach(() => {
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
    restoreEnvironmentValue(
      'FLOOD_PROVIDER',
      originalEnvironment.floodProvider,
    );
    restoreEnvironmentValue('NODE_ENV', originalEnvironment.nodeEnvironment);
  });

  it('registers only the read-only controller by default', () => {
    delete process.env.ENABLE_DEV_FLOOD_ENDPOINTS;
    delete process.env.ENABLE_FLOOD_ADMIN_ENDPOINTS;
    delete process.env.FLOOD_ADMIN_TOKEN_SHA256;

    const module = FloodModule.register();

    expect(module.controllers).toEqual([FloodController]);
    expect(module.controllers).not.toContain(DevFloodController);
    expect(module.controllers).not.toContain(FloodAdminController);
  });

  it('registers development mutation endpoints only after explicit opt-in', () => {
    process.env.ENABLE_DEV_FLOOD_ENDPOINTS = 'true';
    delete process.env.ENABLE_FLOOD_ADMIN_ENDPOINTS;
    delete process.env.FLOOD_ADMIN_TOKEN_SHA256;

    const module = FloodModule.register();

    expect(module.controllers).toEqual([
      FloodController,
      DevFloodController,
    ]);
  });

  it('registers authenticated administration independently from development endpoints', () => {
    delete process.env.ENABLE_DEV_FLOOD_ENDPOINTS;
    process.env.ENABLE_FLOOD_ADMIN_ENDPOINTS = 'true';
    process.env.FLOOD_ADMIN_TOKEN_SHA256 = 'ab'.repeat(32);

    const module = FloodModule.register();

    expect(module.controllers).toEqual([
      FloodController,
      SensorDeploymentAdminController,
      FloodAdminController,
    ]);
    expect(module.controllers).not.toContain(DevFloodController);
  });

  it('selects sensor-backed production and omits simulation mutation controllers', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FLOOD_PROVIDER;
    process.env.ENABLE_DEV_FLOOD_ENDPOINTS = 'true';
    process.env.ENABLE_FLOOD_ADMIN_ENDPOINTS = 'true';
    process.env.FLOOD_ADMIN_TOKEN_SHA256 = 'ab'.repeat(32);

    const module = FloodModule.register();

    expect(module.controllers).toEqual([
      FloodController,
      SensorDeploymentAdminController,
    ]);
    expect(module.controllers).not.toContain(DevFloodController);
    expect(module.controllers).not.toContain(FloodAdminController);
    expect(module.providers).toContainEqual({
      provide: FLOOD_HAZARD_PROVIDER,
      useExisting: SensorFloodHazardProvider,
    });
  });
});

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
