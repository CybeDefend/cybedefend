/**
 * Test-side translation resolver.
 *
 * Tests used to mock `t` as `(key, fallback) => fallback`, which asserted on a
 * hardcoded English string living in the component. Those fallbacks are gone —
 * a missing key must now surface rather than be papered over — so the mock
 * resolves against the real `en` locale instead.
 *
 * The upside is that an assertion on visible English text now also proves the
 * key exists: delete a key and the test fails, which is exactly what the
 * fallbacks used to hide.
 *
 * Usage:
 *   vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
 */

// The core's fragments, then the closed tree's (its locales, merged
// over the core's at runtime through the edition entry, absent from the
// Community Edition, where this second pattern matches nothing). Read as data:
// importing the edition entry from a `vi.mock` factory would deadlock.
type LocaleModule = { default: Record<string, unknown> };
const modules: Record<string, LocaleModule> = {
  ...(import.meta.glob('../i18n/locales/en/**/*.json', { eager: true }) as Record<string, LocaleModule>),
  ...(import.meta.glob('../ee/i18n/locales/en/**/*.json', { eager: true }) as Record<string, LocaleModule>),
};

const deepMerge = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const prev = a[k];
      a[k] = deepMerge(
        prev && typeof prev === 'object' && !Array.isArray(prev) ? (prev as Record<string, unknown>) : {},
        v as Record<string, unknown>,
      );
    } else a[k] = v;
  }
  return a;
};

/**
 * A fragment's key prefix comes from its path, not its contents:
 * `en/billing.json` holds `billing.*`, `en/pages/x/_self.json` holds `pages.x.*`.
 * Some fragments already carry that hierarchy inside them, so wrapping is
 * conditional. This mirrors `loadLocale` in `src/i18n/index.ts` — the two must
 * agree or a key that resolves in the app fails in tests, and vice versa.
 */
export function buildDictionary(entries: Array<[string, Record<string, unknown>]>): Record<string, unknown> {
  let acc: Record<string, unknown> = {};

  for (const [fullPath, raw] of entries) {
    const pathAfterLang = fullPath.replace(/\\/g, '/').split('/locales/en/')[1];
    if (!pathAfterLang) {
      acc = deepMerge(acc, raw);
      continue;
    }

    const parts = pathAfterLang.split('/').filter(Boolean);
    const baseName = parts[parts.length - 1].replace(/\.json$/, '');
    const segments = baseName === '_self' ? parts.slice(0, -1) : [...parts.slice(0, -1), baseName];
    if (!segments.length) {
      acc = deepMerge(acc, raw);
      continue;
    }

    const isFullyWrapped = (() => {
      let cursor: unknown = raw;
      for (const seg of segments) {
        if (cursor && typeof cursor === 'object' && Object.prototype.hasOwnProperty.call(cursor, seg)) {
          cursor = (cursor as Record<string, unknown>)[seg];
        } else return false;
      }
      return true;
    })();

    let inner: Record<string, unknown>;
    if (isFullyWrapped) {
      inner = raw;
    } else {
      const last = segments[segments.length - 1];
      inner = Object.prototype.hasOwnProperty.call(raw, last) ? raw : { [last]: raw };
      for (let i = segments.length - 2; i >= 0; i--) inner = { [segments[i]]: inner };
    }

    acc = deepMerge(acc, inner);
  }

  return acc;
}

const dictionary = buildDictionary(
  Object.entries(modules).map(([p, mod]) => [p, (mod.default ?? mod) as Record<string, unknown>]),
);

const lookup = (key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (cur, k) => (cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined),
      dictionary,
    );

/**
 * Resolve a dotted key. Interpolates `{{name}}` placeholders from `opts`.
 * An unknown key returns the key itself — visible in a failed assertion.
 */
export function translate(key: string | string[], opts?: Record<string, unknown>): string {
  // i18next accepts a key fallback array; take the first one that resolves.
  const keys = Array.isArray(key) ? key : [key];

  for (const k of keys) {
    // Plurals live under `_one` / `_other` suffixes, which a bare lookup misses.
    let value = lookup(k);
    if (typeof value !== 'string' && opts?.count !== undefined) {
      value = lookup(`${k}_${opts.count === 1 ? 'one' : 'other'}`);
    }
    if (typeof value !== 'string') continue;
    if (!opts) return value;

    return value.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
      opts[name] === undefined ? whole : String(opts[name]),
    );
  }

  if (typeof opts?.defaultValue === 'string') return opts.defaultValue;
  return keys[0];
}

/** Drop-in replacement for `vi.mock('react-i18next', …)`. */
export const reactI18nextMock = () => ({
  useTranslation: () => ({
    t: translate,
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => translate(i18nKey),
  initReactI18next: { type: '3rdParty', init: () => {} },
});
