import { describe, it, expect } from 'vitest';
import { features } from '@/utils/featureFlags';

describe('Layout realtime trial wiring', () => {
  it('feature flag for trial realtime exists and defaults to true', () => {
    expect(features.realtime).toHaveProperty('trial');
    expect(features.realtime.trial).toBe(true);
  });
});
