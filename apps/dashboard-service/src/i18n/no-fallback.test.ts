import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');
const LOCALES = path.join(SRC, 'i18n/locales');
/** The core's locale fragments, then the closed tree's when it is there (merged over them at runtime). */
const EE_LOCALES = path.join(SRC, 'ee/i18n/locales');
const LOCALE_ROOTS = [LOCALES, ...(fs.existsSync(EE_LOCALES) ? [EE_LOCALES] : [])];

/**
 * `t('some.key', 'English fallback')` was used 835 times. When the key was
 * missing from `fr/`, the fallback shipped English into a French interface —
 * silently, with no error anywhere. Every key now exists in both locales and
 * the fallbacks are gone; this test keeps them gone, so a missing translation
 * fails loudly instead of degrading to English.
 *
 * `defaultValue` is the same escape hatch under another name. The literal form
 * — a literal key with a literal default — is gone too and is guarded here.
 * The 20 remaining sites compute the key or the default at runtime (plan names,
 * report types), so no fixed key set exists to translate against; they are
 * deliberately out of scope rather than forgotten.
 */
const FALLBACK = /\bt\(\s*(['"])[\w.\-]+\1\s*,\s*(['"])/g;
const LITERAL_DEFAULT = /\bt\(\s*(['"])[\w.\-]+\1\s*,\s*\{[^{}]*\bdefaultValue\s*:\s*['"]/g;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'locales' || entry.name === 'test') continue;
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

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

function locale(lng: string) {
  const out: Record<string, unknown> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (f.endsWith('.json')) deepMerge(out, JSON.parse(fs.readFileSync(f, 'utf8')));
    }
  };
  for (const root of LOCALE_ROOTS) walk(path.join(root, lng));
  return out;
}

/** Every leaf key, as a dotted path. */
function leaves(obj: Record<string, unknown>, prefix = '', acc: string[] = []): string[] {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) leaves(v as Record<string, unknown>, p, acc);
    else acc.push(p);
  }
  return acc;
}

describe('i18n', () => {
  it('never falls back to a hardcoded string', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(SRC, file);
      if (FALLBACK.test(text)) offenders.push(`${rel} → t('key', 'fallback')`);
      FALLBACK.lastIndex = 0;
      if (LITERAL_DEFAULT.test(text)) offenders.push(`${rel} → t('key', { defaultValue: '…' })`);
      LITERAL_DEFAULT.lastIndex = 0;
    }

    expect(
      offenders,
      `translation fallbacks reintroduced — add the key to fr/ and en/ instead:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * `loadLocale` derives a fragment's key prefix from its path, and treats a
   * fragment that already contains that prefix as pre-wrapped — merging it at
   * the root untouched. A file that carries *both* (a `billing` subtree and
   * bare siblings next to it) therefore has its siblings merged at the root,
   * where nothing can reach them: `billing.trial.x` resolves to nothing while
   * the key sits right there in the file. That is how `billing.json` silently
   * lost 35 keys, which is what the `defaultValue` fallbacks were hiding.
   */
  it('keeps every fragment reachable under its path-derived namespace', () => {
    const offenders: string[] = [];

    for (const [lng, root] of ['en', 'fr'].flatMap((l) => LOCALE_ROOTS.map((r) => [l, path.join(r, l)] as const))) {
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            walk(full);
            continue;
          }
          if (!full.endsWith('.json')) continue;

          const parts = path.relative(root, full).split(path.sep);
          const base = parts[parts.length - 1].replace(/\.json$/, '');
          const segments = base === '_self' ? parts.slice(0, -1) : [...parts.slice(0, -1), base];
          if (!segments.length) continue;

          const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
          let cursor: unknown = raw;
          const preWrapped = segments.every((s) => {
            if (cursor && typeof cursor === 'object' && Object.prototype.hasOwnProperty.call(cursor, s)) {
              cursor = (cursor as Record<string, unknown>)[s];
              return true;
            }
            return false;
          });

          const siblings = Object.keys(raw).filter((k) => k !== segments[0]);
          if (preWrapped && siblings.length) {
            offenders.push(
              `${lng}/${path.relative(root, full)} → wraps "${segments[0]}" but also holds ${siblings.length} root key(s) ` +
                `(${siblings.slice(0, 3).join(', ')}…) that no key path can reach`,
            );
          }
        }
      };
      walk(root);
    }

    expect(
      offenders,
      `unreachable translation keys — move them inside the namespace object:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps fr and en carrying the same keys', () => {
    const fr = new Set(leaves(locale('fr')));
    const en = new Set(leaves(locale('en')));

    const missingFr = [...en].filter((k) => !fr.has(k));
    const missingEn = [...fr].filter((k) => !en.has(k));

    expect(missingFr, `keys present in en but missing in fr:\n${missingFr.join('\n')}`).toEqual([]);
    expect(missingEn, `keys present in fr but missing in en:\n${missingEn.join('\n')}`).toEqual([]);
  });

  /**
   * A key that is USED but exists nowhere renders as its own dotted path, in
   * front of the user: "billing.addons.current_quantity" sat under the addon
   * cards, and "pages.settingsUsage.analysisLimitModal.maxInfo" under the deep
   * analysis budget input.
   *
   * None of the three tests above could see it. Fallbacks were gone, the
   * namespaces were reachable, and fr/en parity HELD — precisely because the
   * key was absent from both sides. The guard was watching the wrong axis:
   * it compared the locales to each other, never to the code that calls them.
   *
   * 36 keys were in that state. They are now filled in, so this asserts zero
   * and keeps it there. Only literal keys can be checked; the handful built at
   * runtime (plan names, report types) have no fixed key set to test against.
   *
   * `en` alone is enough: the parity test above already fails if `fr` drifts
   * from it.
   */
  it('never asks for a key that does not exist', () => {
    // The loader derives a fragment's prefix from its path, so the flat
    // `locale()` above cannot answer "does this dotted key resolve?".
    const dict: Record<string, unknown> = {};
    const walk = (dir: string, root: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full, root);
          continue;
        }
        if (!full.endsWith('.json')) continue;
        const raw = JSON.parse(fs.readFileSync(full, 'utf8')) as Record<string, unknown>;
        const parts = path.relative(root, full).split(path.sep);
        const base = parts[parts.length - 1].replace(/\.json$/, '');
        const segments = base === '_self' ? parts.slice(0, -1) : [...parts.slice(0, -1), base];
        if (!segments.length) {
          deepMerge(dict, raw);
          continue;
        }
        let cursor: unknown = raw;
        let wrapped = true;
        for (const seg of segments) {
          if (cursor && typeof cursor === 'object' && seg in (cursor as object)) {
            cursor = (cursor as Record<string, unknown>)[seg];
          } else {
            wrapped = false;
            break;
          }
        }
        let inner: Record<string, unknown>;
        if (wrapped) inner = raw;
        else {
          const last = segments[segments.length - 1];
          inner = last in raw ? raw : { [last]: raw };
          for (let i = segments.length - 2; i >= 0; i--) inner = { [segments[i]]: inner };
        }
        deepMerge(dict, inner);
      }
    };
    for (const root of LOCALE_ROOTS) walk(path.join(root, 'en'), path.join(root, 'en'));

    /** Plurals live under `_one`/`_other`; `returnObjects` keys hold arrays. */
    const PLURALS = ['', '_one', '_other', '_zero', '_two', '_few', '_many'];
    const resolves = (key: string): boolean => {
      const segs = key.split('.');
      let node: unknown = dict;
      for (const seg of segs.slice(0, -1)) {
        if (node && typeof node === 'object' && seg in (node as object)) {
          node = (node as Record<string, unknown>)[seg];
        } else return false;
      }
      if (!node || typeof node !== 'object') return false;
      const leaf = segs[segs.length - 1];
      return PLURALS.some((suffix) => {
        const v = (node as Record<string, unknown>)[leaf + suffix];
        return typeof v === 'string' || Array.isArray(v);
      });
    };

    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(SRC, file);
      for (const m of text.matchAll(/\bt\(\s*'([a-zA-Z0-9_.\-]+)'/g)) {
        if (!resolves(m[1])) offenders.push(`${rel} → ${m[1]}`);
      }
    }

    expect(
      [...new Set(offenders)],
      `these keys render as raw dotted paths to the user — add them to en/ and fr/:\n${[...new Set(offenders)].join('\n')}`,
    ).toEqual([]);
  });

});
