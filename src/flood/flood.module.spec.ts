import { DevFloodController } from './dev/dev-flood.controller';
import { FloodController } from './flood.controller';
import { FloodModule } from './flood.module';

describe('FloodModule', () => {
  const originalValue = process.env.ENABLE_DEV_FLOOD_ENDPOINTS;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.ENABLE_DEV_FLOOD_ENDPOINTS;
    } else {
      process.env.ENABLE_DEV_FLOOD_ENDPOINTS = originalValue;
    }
  });

  it('registers only the read-only controller by default', () => {
    delete process.env.ENABLE_DEV_FLOOD_ENDPOINTS;

    const module = FloodModule.register();

    expect(module.controllers).toEqual([FloodController]);
    expect(module.controllers).not.toContain(DevFloodController);
  });

  it('registers development mutation endpoints only after explicit opt-in', () => {
    process.env.ENABLE_DEV_FLOOD_ENDPOINTS = 'true';

    const module = FloodModule.register();

    expect(module.controllers).toEqual([
      FloodController,
      DevFloodController,
    ]);
  });
});
