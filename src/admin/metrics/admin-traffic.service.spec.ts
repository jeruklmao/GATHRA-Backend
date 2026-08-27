import {
  normalizeHttpRoute,
  percentileFromHistogram,
} from './admin-traffic.service';

describe('admin traffic aggregation helpers', () => {
  it('normalizes dynamic identifiers and drops query parameters', () => {
    expect(normalizeHttpRoute('/api/v1/iot/nodes/GTH-10003BD4BCFC?raw=true')).toBe(
      '/api/v1/iot/nodes/:nodeId',
    );
    expect(normalizeHttpRoute('/api/v1/admin/dashboard/sensor-deployments/N-1')).toBe(
      '/api/v1/admin/dashboard/sensor-deployments/:nodeId',
    );
    expect(normalizeHttpRoute('/items/1234')).toBe('/items/:id');
    expect(normalizeHttpRoute('/search?q=private-value')).toBe('/search');
    expect(normalizeHttpRoute('/odd/$shell')).toBe('/odd/:value');
  });

  it('derives approximate percentiles from fixed histogram buckets', () => {
    const histogram = [1, 1, 2, 6, 0, 0, 0, 0, 0, 0];
    expect(percentileFromHistogram(histogram, 0.5)).toBe(250);
    expect(percentileFromHistogram(histogram, 0.95)).toBe(250);
    expect(percentileFromHistogram([], 0.95)).toBeNull();
  });
});
