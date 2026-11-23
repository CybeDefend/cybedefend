import { beforeEach, describe, expect, it, vi } from 'vitest';
// Its first case imports the edition entry, which evaluates the closed tree
// (several seconds alone); under the full suite's load that passed 5 s.
vi.setConfig({ testTimeout: 30_000 });
import { EMPTY_EXTENSIONS } from './extensions';

/**
 * The product registry of `utils/product.ts`: the core's own AppSec space plus
 * the spaces the active edition registers (`ACTIVE_EXTENSIONS.products`). A
 * community build (EMPTY_EXTENSIONS) knows one space alone.
 *
 * Each case re-imports the module under a mocked `@/edition/active`, so the
 * registry is read as it would be in that edition.
 */
describe('the product registry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('the core alone knows one space, the AppSec one, at /appsec', async () => {
    vi.doMock('@/edition/active', () => ({ ACTIVE_EXTENSIONS: EMPTY_EXTENSIONS }));
    const p = await import('@/utils/product');
    expect(p.PRODUCTS).toEqual(['appsec']);
    expect(p.productFromPath('/appsec/project/1')).toBe('appsec');
    expect(p.productFromPath('/other')).toBeNull();
    expect(p.productHome('appsec')).toBe('/appsec');
    vi.doUnmock('@/edition/active');
  });

  it('a registered space keeps today’s order and prefix', async () => {
    vi.doMock('@/edition/active', () => ({
      ACTIVE_EXTENSIONS: {
        ...EMPTY_EXTENSIONS,
        products: [{ id: 'other', prefix: '/other', order: 0, labelKey: 'k' }],
      },
    }));
    const p = await import('@/utils/product');
    expect(p.PRODUCTS).toEqual(['other', 'appsec']);
    expect(p.productFromPath('/other/x')).toBe('other');
    expect(p.spaceOf('other' as never).prefix).toBe('/other');
    vi.doUnmock('@/edition/active');
  });

  it('with one space, the landing goes to the AppSec home and asks nothing', async () => {
    vi.doMock('@/edition/active', () => ({ ACTIVE_EXTENSIONS: EMPTY_EXTENSIONS }));
    const { landingPath } = await import('@/utils/landing');
    expect(landingPath({ preferred: null, known: true, active: [], denied: [] })).toBe('/appsec');
    vi.doUnmock('@/edition/active');
  });

  it('the core alone starts every account in AppSec, whatever its usage answer', async () => {
    vi.doMock('@/edition/active', () => ({ ACTIVE_EXTENSIONS: EMPTY_EXTENSIONS }));
    const { productFromUsage } = await import('@/utils/landing');
    expect(productFromUsage(['vibecoding'])).toBe('appsec');
    expect(productFromUsage(['team_security'])).toBe('appsec');
    vi.doUnmock('@/edition/active');
  });

  it('a registered space starts the accounts whose usage answer it claims', async () => {
    vi.doMock('@/edition/active', () => ({
      ACTIVE_EXTENSIONS: {
        ...EMPTY_EXTENSIONS,
        products: [{ id: 'other', prefix: '/other', order: 0, labelKey: 'k', landingUsage: ['agents'] }],
      },
    }));
    const { productFromUsage } = await import('@/utils/landing');
    expect(productFromUsage(['compliance', 'agents'])).toBe('other');
    expect(productFromUsage(['compliance'])).toBe('appsec');
    expect(productFromUsage(null)).toBe('appsec');
    vi.doUnmock('@/edition/active');
  });
});

/**
 * `utils/product.ts` reads the edition entry, and the closed tree's code reads
 * `utils/product.ts`: the entry and its registers must load without the
 * product registry, whichever module a page, a test or the boot reaches first.
 * A register that imports a screen or a guard eagerly would read the registry
 * before it is initialised (a ReferenceError at module evaluation).
 */
describe('the product registry and the edition entry, in any load order', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  /** Every registered space and AppSec, each at its own prefix. */
  const expectRegistryLoaded = async (p: typeof import('@/utils/product')): Promise<void> => {
    const { ACTIVE_EXTENSIONS } = await import('@/edition/active');
    expect(p.PRODUCTS).toHaveLength(ACTIVE_EXTENSIONS.products.length + 1);
    expect(p.PRODUCTS).toContain('appsec');
    for (const space of ACTIVE_EXTENSIONS.products) {
      expect(p.productHome(space.id as never)).toBe(space.prefix);
    }
  };

  it('loads when the edition entry is reached first', async () => {
    await import('@/edition/active');
    await expectRegistryLoaded(await import('@/utils/product'));
  });

  it('loads when the closed tree’s entry is reached first', async () => {
    await import('@/edition/ee-entry');
    await expectRegistryLoaded(await import('@/utils/product'));
  });

  it('loads when the product registry is reached first', async () => {
    await expectRegistryLoaded(await import('@/utils/product'));
  });
});

describe('readyProductSpaces', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('loads every component of the registered spaces that loads on demand, the wizard steps included', async () => {
    const ready = vi.fn(() => Promise.resolve());
    const loading = Object.assign(() => null, { ready });
    vi.doMock('@/edition/active', () => ({
      ACTIVE_EXTENSIONS: {
        ...EMPTY_EXTENSIONS,
        products: [
          {
            id: 'other',
            prefix: '/other',
            order: 0,
            labelKey: 'k',
            ProjectGeneralSettings: loading,
            createProjectSteps: [{ id: 's', order: 1, product: 'other', Component: loading }],
          },
        ],
      },
    }));
    const p = await import('@/utils/product');
    await p.readyProductSpaces();
    expect(ready).toHaveBeenCalledTimes(2);
    vi.doUnmock('@/edition/active');
  });
});
