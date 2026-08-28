import { gatewayFreshness } from './gateway-heartbeat.models';

describe('gatewayFreshness', () => {
  const heartbeat = new Date('2026-08-28T00:00:00.000Z');

  it.each([
    [0, 'ONLINE'],
    [120, 'ONLINE'],
    [120.001, 'STALE'],
    [300, 'STALE'],
    [300.001, 'OFFLINE'],
  ])('classifies a 60-second interval at age %s', (age, state) => {
    expect(gatewayFreshness(heartbeat, 60, new Date(heartbeat.getTime() + age * 1_000)).state).toBe(state);
  });

  it.each([
    [600, 'ONLINE'],
    [600.001, 'STALE'],
    [1_500, 'STALE'],
    [1_500.001, 'OFFLINE'],
  ])('uses a dynamic 300-second interval at age %s', (age, state) => {
    expect(gatewayFreshness(heartbeat, 300, new Date(heartbeat.getTime() + age * 1_000)).state).toBe(state);
  });

  it('does not label a pre-heartbeat Gateway offline', () => {
    expect(gatewayFreshness(null, null, new Date()).state).toBe('HEARTBEAT_UNAVAILABLE');
  });
});
