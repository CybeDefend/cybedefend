import { describe, it, expect } from 'vitest';
import { features } from './featureFlags';

describe('featureFlags', () => {
  it('exposes a per-page realtime flags object', () => {
    expect(features.realtime).toHaveProperty('projectList');
    expect(features.realtime).toHaveProperty('issues');
    expect(features.realtime).toHaveProperty('trial');
    expect(features.realtime).toHaveProperty('projectStats');
    expect(features.realtime).toHaveProperty('orgOverview');
    expect(features.realtime).toHaveProperty('policies');
    expect(features.realtime).toHaveProperty('members');
    expect(features.realtime).toHaveProperty('teams');
  });

  it('defaults all flags to true when env not set', () => {
    Object.values(features.realtime).forEach((v) => expect(v).toBe(true));
  });
});
