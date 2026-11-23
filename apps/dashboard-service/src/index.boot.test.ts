import { describe, expect, it, vi } from 'vitest';

const { bootA, bootB, renderSpy, createRootSpy, EditionAuthProvider } = vi.hoisted(() => ({
  bootA: vi.fn(),
  bootB: vi.fn(),
  renderSpy: vi.fn(),
  createRootSpy: vi.fn(() => ({ render: renderSpy })),
  EditionAuthProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('react-dom/client', () => ({
  default: { createRoot: createRootSpy },
  createRoot: createRootSpy,
}));

// The edition seam is replaced by two boot hooks: the test pins that index.tsx
// runs each of them exactly once, in order, before it renders the app.
vi.mock('@/edition/active', () => ({
  ACTIVE_EXTENSIONS: {
    locales: { en: {}, fr: {} },
    products: [],
    ProductRouteGuard: null,
    boot: [bootA, bootB],
    AppEffects: null,
    ShellEffects: null,
    reducers: {},
    responseInterceptors: [],
    AuthProvider: EditionAuthProvider,
    billing: null,
    memberProducts: null,
  },
}));

// Everything the entry pulls in besides the seam is stubbed: only index.tsx's
// own statements are under test.
vi.mock('./App', () => ({ default: () => null }));
vi.mock('./server/store', () => ({ default: { dispatch: vi.fn(), getState: vi.fn() } }));
vi.mock('react-rebac', () => ({ RebacProvider: ({ children }: { children: unknown }) => children }));
vi.mock('./reportWebVitals', () => ({ default: vi.fn() }));
vi.mock('./components/organismes/app-failure/AppErrorBoundary', () => ({
  AppErrorBoundary: ({ children }: { children: unknown }) => children,
}));
vi.mock('./i18n', () => ({}));

/** Whether `type` is rendered somewhere in the element tree. */
function renders(node: unknown, type: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((child) => renders(child, type));
  const element = node as { type?: unknown; props?: { children?: unknown } };
  return element.type === type || renders(element.props?.children, type);
}

describe('index.tsx boot', () => {
  it('runs each boot hook once, in order, before render', async () => {
    await import('./index');

    expect(bootA).toHaveBeenCalledTimes(1);
    expect(bootB).toHaveBeenCalledTimes(1);
    expect(bootA.mock.invocationCallOrder[0]).toBeLessThan(bootB.mock.invocationCallOrder[0]);
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(bootA.mock.invocationCallOrder[0]).toBeLessThan(renderSpy.mock.invocationCallOrder[0]);
    expect(bootB.mock.invocationCallOrder[0]).toBeLessThan(renderSpy.mock.invocationCallOrder[0]);
  });

  it("wraps the app in the active edition's auth provider", async () => {
    await import('./index');

    expect(renders(renderSpy.mock.calls[0][0], EditionAuthProvider)).toBe(true);
  });
});
