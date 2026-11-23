import type { LocaleModules } from '@/edition/extensions';

// `modules` is the eager glob of one language's fragments, core or ee.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A glob module's content: its `default` key when it exists, else the module itself. */
const rawOf = (mod: unknown): unknown => {
  if (isRecord(mod) && 'default' in mod && mod.default) return mod.default;
  return mod;
};

// Simple deep merge
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Record<string, unknown>): T {
  if (!source) return target;
  const out: Record<string, unknown> = target;
  for (const key of Object.keys(source)) {
    const v = source[key];
    if (isRecord(v)) {
      const existing = out[key];
      out[key] = deepMerge(isRecord(existing) ? existing : {}, v);
    } else {
      out[key] = v;
    }
  }
  return target;
}

export function loadLocale(modules: LocaleModules, lang: 'en' | 'fr'): Record<string, unknown> {
  const entries = Object.entries(modules || {});
  if (!entries.length) {
    // No fragment found (abnormal). Return an empty object rather than crash.
    if (import.meta.env?.DEV) console.warn(`[i18n] No fragments found for '${lang}'. Returning empty object.`);
    return {};
  }
  let acc: Record<string, unknown> = {};
  for (const [fullPath, mod] of entries) {
    const raw = rawOf(mod);
    // The expected segments, computed from the path
    // Example: ./locales/en/components/historyTimeline.json => ['components','historyTimeline']
    // Example: ./locales/en/components/analysisTable/_self.json => ['components','analysisTable']
    // Example: ./locales/en/components/projectOverview/state/descriptions.json => ['components','projectOverview','state','descriptions']
    const normalized = fullPath.replace(/\\/g, '/');
    const pathAfterLang = normalized.split(`/locales/${lang}/`)[1];
    if (!pathAfterLang) {
      acc = deepMerge(acc, isRecord(raw) ? raw : {});
      continue;
    }
    const parts = pathAfterLang.split('/').filter(Boolean);
    // Drop the file name for _self.json: it is not a segment
    const fileName = parts[parts.length - 1];
    const baseName = fileName.replace(/\.json$/, '');
    let segments = parts.slice(0, -1); // folders
    if (baseName !== '_self') {
      segments = [...segments, baseName];
    }
    if (!segments.length) {
      acc = deepMerge(acc, isRecord(raw) ? raw : {});
      continue;
    }
    const last = segments[segments.length - 1];

    // Whether the fragment is already wrapped from the first segment to the last
    const isFullyWrapped = (() => {
      if (!isRecord(raw)) return false;
      let cursor: unknown = raw;
      for (let i = 0; i < segments.length; i++) {
        if (isRecord(cursor) && Object.prototype.hasOwnProperty.call(cursor, segments[i])) {
          // cybedefend-ignore[CD-SAST-1364]: a read, not a write; the keys come from the translation files bundled at build time, never from user input
          cursor = cursor[segments[i]];
        } else {
          return false;
        }
      }
      return true; // every segment already exists
    })();

    let inner: Record<string, unknown>;
    if (isFullyWrapped) {
      // The JSON already holds the whole hierarchy (the fragments' current shape)
      inner = raw as Record<string, unknown>;
    } else {
      // (Re)build the minimal expected hierarchy
      if (isRecord(raw) && Object.prototype.hasOwnProperty.call(raw, last)) {
        inner = raw; // already { last: {...} }
      } else {
        inner = { [last]: raw };
      }
      for (let i = segments.length - 2; i >= 0; i--) {
        inner = { [segments[i]]: inner };
      }
    }

    acc = deepMerge(acc, inner);
  }
  return acc;
}
