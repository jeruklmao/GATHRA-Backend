import { activityStatus } from './admin-dashboard.service';

describe('dashboard Node activity status', () => {
  const now = Date.parse('2026-08-27T12:00:00Z');

  it('uses inclusive expected-poll and stale boundaries', () => {
    expect(activityStatus(new Date(now - 10 * 60_000).toISOString(), 10, 30, now).status).toBe('ONLINE');
    expect(activityStatus(new Date(now - 10 * 60_000 - 1).toISOString(), 10, 30, now).status).toBe('STALE');
    expect(activityStatus(new Date(now - 30 * 60_000).toISOString(), 10, 30, now).status).toBe('STALE');
    expect(activityStatus(new Date(now - 30 * 60_000 - 1).toISOString(), 10, 30, now).status).toBe('OFFLINE');
  });

  it('does not invent status without deployment timing configuration', () => {
    expect(activityStatus(null, undefined, undefined, now)).toEqual({
      status: 'UNCONFIGURED',
      ageMinutes: null,
    });
  });
});
