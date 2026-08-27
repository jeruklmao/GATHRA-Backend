import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AdminObserverService, sanitizeLogLine } from './admin-observer.service';

describe('AdminObserverService', () => {
  let directory: string;
  const original = process.env.ADMIN_OBSERVER_DIRECTORY;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'gathra-observer-test-'));
    process.env.ADMIN_OBSERVER_DIRECTORY = directory;
  });

  afterEach(async () => {
    if (original === undefined) delete process.env.ADMIN_OBSERVER_DIRECTORY;
    else process.env.ADMIN_OBSERVER_DIRECTORY = original;
    await rm(directory, { recursive: true, force: true });
  });

  it('degrades safely for missing and malformed snapshots', async () => {
    const service = new AdminObserverService();
    await expect(service.snapshot()).resolves.toMatchObject({ available: false, stale: true });
    await writeFile(path.join(directory, 'status.json'), '{broken');
    await expect(service.snapshot()).resolves.toMatchObject({ available: false, stale: true });
  });

  it('accepts a bounded valid snapshot and identifies stale observations', async () => {
    const observedAt = new Date(Date.now() - 16_000).toISOString();
    await writeFile(path.join(directory, 'status.json'), JSON.stringify({
      schemaVersion: 1,
      observedAt,
      host: {},
      containers: {},
      services: {},
      release: {},
      backup: null,
    }));
    await expect(new AdminObserverService().snapshot()).resolves.toMatchObject({
      available: true,
      stale: true,
      snapshot: { observedAt },
    });
  });

  it('bounds and filters log text without executing search input', async () => {
    await mkdir(path.join(directory, 'logs'));
    await writeFile(
      path.join(directory, 'logs', 'backend.log'),
      '\u001b[31mERROR <script>alert(1)</script>\u001b[0m\nINFO normal\n',
    );
    const result = await new AdminObserverService().logs({
      source: 'backend',
      lines: 100,
      search: '<script>',
      severity: 'ERROR',
    });
    expect(result.lines).toEqual(['ERROR <script>alert(1)</script>']);
    await expect(
      new AdminObserverService().logs({ source: '../../etc/passwd', lines: 100 }),
    ).rejects.toThrow('INVALID_LOG_SOURCE');
    expect(sanitizeLogLine('a\u0000b\u001b[31mc')).toBe('abc');
  });
});
