import { afterEach, describe, expect, it, vi } from 'vitest';

type ConfigWindow = Window & { __CYBEDEFEND_CONFIG__?: unknown };

afterEach(() => {
  delete (window as ConfigWindow).__CYBEDEFEND_CONFIG__;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('region apiUrl', () => {
  it('comes from the runtime configuration when config.js sets one', async () => {
    vi.stubEnv('VITE_GATEWAY_URL', 'http://localhost:3000');
    (window as ConfigWindow).__CYBEDEFEND_CONFIG__ = { apiUrl: '/api' };
    vi.resetModules();
    const { getRegionConfig } = await import('./region');
    expect(getRegionConfig().apiUrl).toBe(`${window.location.origin}/api`);
  });

  it('keeps the build value when config.js is the empty default', async () => {
    vi.stubEnv('VITE_GATEWAY_URL', 'http://localhost:3000');
    (window as ConfigWindow).__CYBEDEFEND_CONFIG__ = {};
    vi.resetModules();
    const { getRegionConfig } = await import('./region');
    expect(getRegionConfig().apiUrl).toBe('http://localhost:3000');
  });
});
