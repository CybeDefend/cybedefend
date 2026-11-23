import { describe, it, expect } from 'vitest';
import { features } from '@/utils/featureFlags';

describe('useTeamUsers realtime wiring', () => {
  it('exports a feature flag that defaults to true', () => {
    expect(features.realtime.teams).toBe(true);
  });
});
