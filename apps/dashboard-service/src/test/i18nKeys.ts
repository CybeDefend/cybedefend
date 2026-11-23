import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * The translation-key collector of `src/i18n/keys-exist.test.ts`, shared with
 * the edition's locale tests (`src/i18n/coreLocales.community.test.ts`,
 * the closed tree's locale tests): the dictionary `loadLocale` builds from locale
 * roots, and every key the sources can ask for.
 */

export const SRC = path.resolve(__dirname, '..');
/** The core's locale fragments. */
export const CORE_LOCALES = path.join(SRC, 'i18n/locales');
/** The closed tree's locale fragments (absent in the Community Edition). */
export const EE_LOCALES = path.join(SRC, 'ee/i18n/locales');
/** Every locale root of this tree, core first. */
export const LOCALE_ROOTS: string[] = [CORE_LOCALES, ...(fs.existsSync(EE_LOCALES) ? [EE_LOCALES] : [])];

export type Dict = Record<string, unknown>;
export const LANGS = ['en', 'fr'] as const;
export type Lang = (typeof LANGS)[number];

/** Property names that hold a whole translation key (`messageKey` holds a suffix completed by its caller). */
const LABEL_KEY_PROPERTY = /^(label|title|description|subtitle|heading|text|placeholder|aria|i18n|translation|name)Key$/;

const PLURALS = ['', '_one', '_other', '_zero', '_two', '_few', '_many'];

export const deepMerge = (a: Dict, b: Dict): Dict => {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const prev = a[k];
      a[k] = deepMerge(prev && typeof prev === 'object' && !Array.isArray(prev) ? (prev as Dict) : {}, v as Dict);
    } else a[k] = v;
  }
  return a;
};

/** One fragment as `loadLocale` (src/i18n/loadLocale.ts) places it: its prefix comes from its path under the language folder. */
export function wrapFragment(raw: Dict, relPath: string): Dict {
  const parts = relPath.split(/[\\/]/);
  const base = parts[parts.length - 1].replace(/\.json$/, '');
  const segments = base === '_self' ? parts.slice(0, -1) : [...parts.slice(0, -1), base];
  if (!segments.length) return raw;
  let cursor: unknown = raw;
  let wrapped = true;
  for (const seg of segments) {
    if (cursor && typeof cursor === 'object' && seg in (cursor as object)) cursor = (cursor as Dict)[seg];
    else {
      wrapped = false;
      break;
    }
  }
  if (wrapped) return raw;
  const last = segments[segments.length - 1];
  let inner: Dict = last in raw ? raw : { [last]: raw };
  for (let i = segments.length - 2; i >= 0; i--) inner = { [segments[i]]: inner };
  return inner;
}

/** Every `.json` fragment of one language under one root, as paths relative to `<root>/<lng>`. */
export function fragmentsOf(root: string, lng: Lang): string[] {
  const out: string[] = [];
  const base = path.join(root, lng);
  if (!fs.existsSync(base)) return out;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (full.endsWith('.json')) out.push(path.relative(base, full));
    }
  };
  walk(base);
  return out.sort();
}

/** The dictionary `loadLocale` (src/i18n/index.ts) builds from these roots: a fragment's prefix comes from its path. */
export function loadDict(lng: Lang, roots: readonly string[] = LOCALE_ROOTS): Dict {
  const dict: Dict = {};
  for (const root of roots) {
    for (const rel of fragmentsOf(root, lng)) {
      const raw = JSON.parse(fs.readFileSync(path.join(root, lng, rel), 'utf8')) as Dict;
      deepMerge(dict, wrapFragment(raw, rel));
    }
  }
  return dict;
}

export function nodeAt(dict: Dict, key: string): unknown {
  let node: unknown = dict;
  for (const seg of key.split('.')) {
    if (node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, seg)) node = (node as Dict)[seg];
    else return undefined;
  }
  return node;
}

/** A key `t()` can render: a string (or a plural form of it), or an array for `returnObjects`. */
export function isLeaf(dict: Dict, key: string): boolean {
  const segs = key.split('.');
  const parent = segs.length > 1 ? nodeAt(dict, segs.slice(0, -1).join('.')) : dict;
  if (!parent || typeof parent !== 'object') return false;
  const leaf = segs[segs.length - 1];
  return PLURALS.some((s) => {
    const v = (parent as Dict)[leaf + s];
    return typeof v === 'string' || Array.isArray(v);
  });
}

export const isNode = (dict: Dict, key: string): boolean => {
  const n = nodeAt(dict, key);
  return !!n && typeof n === 'object';
};

/** True for a file of the closed tree (`src/ee/**`) or the one core file that re-exports it. */
export const isClosedSource = (file: string): boolean => {
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  return rel === 'ee' || rel.startsWith('ee/') || rel === 'edition/ee-entry.tsx';
};

/** The source files the collector reads (tests, stories, locales and `src/test` left out). */
export function sourceFiles(dir: string = SRC, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'locales', 'test', '__tests__', 'dev'].includes(entry.name)) continue;
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec|stories)\.|\.d\.ts$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** A piece of a key: literal text, a set of literal alternatives, or a runtime value. */
export type Part = { lit: string } | { alts: string[] } | { open: string };

const unwrap = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression;
  return x;
};
const literalOf = (e: ts.Expression): string | null => {
  const x = unwrap(e);
  return ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) ? x.text : null;
};

export interface Use {
  where: string;
  key: string;
  kind: 'key' | 'objects';
}
export interface Built {
  where: string;
  parts: Part[];
}
export interface KeyScan {
  keys: Use[];
  strays: Use[];
  built: Built[];
}

/**
 * Every key `files` can ask for. `namespaces` are the dictionary's top-level
 * keys: a literal with at least two dots under one of them names a key.
 */
export function scanKeys(files: readonly string[], namespaces: ReadonlySet<string>): KeyScan {
  const keys: Use[] = [];
  const strays: Use[] = [];
  const built: Built[] = [];

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (!/\bt\(|i18nKey|['"`](components|pages|common|navigation|billing)\./.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const rel = path.relative(SRC, file);
    const at = (n: ts.Node) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;

    // `const KEY = 'pages.x'` (any scope): a name used once with one value.
    const consts = new Map<string, Set<string>>();
    const collect = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        const v = literalOf(n.initializer);
        if (v !== null) consts.set(n.name.text, (consts.get(n.name.text) ?? new Set()).add(v));
      }
      ts.forEachChild(n, collect);
    };
    collect(sf);

    const partsOf = (e: ts.Expression): Part[] => {
      const x = unwrap(e);
      const lit = literalOf(x);
      if (lit !== null) return [{ lit }];
      if (ts.isTemplateExpression(x)) {
        const out: Part[] = [{ lit: x.head.text }];
        for (const span of x.templateSpans) out.push(...partsOf(span.expression), { lit: span.literal.text });
        return out;
      }
      if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.PlusToken) return [...partsOf(x.left), ...partsOf(x.right)];
      if (ts.isConditionalExpression(x)) {
        const a = literalOf(x.whenTrue);
        const b = literalOf(x.whenFalse);
        if (a !== null && b !== null) return [{ alts: [a, b] }];
      }
      if (ts.isIdentifier(x) && consts.get(x.text)?.size === 1) return [{ lit: [...consts.get(x.text)!][0] }];
      return [{ open: x.getText(sf) }];
    };
    /** Every key the parts can spell, or null when one part is a runtime value. */
    const spell = (parts: Part[]): string[] | null => {
      let acc = [''];
      for (const p of parts) {
        if ('lit' in p) acc = acc.map((a) => a + p.lit);
        else if ('alts' in p) acc = acc.flatMap((a) => p.alts.map((v) => a + v));
        else return null;
      }
      return acc;
    };
    const record = (parts: Part[], n: ts.Node, kind: Use['kind']) => {
      const spelled = spell(parts);
      if (spelled) for (const key of spelled) keys.push({ where: at(n), key, kind });
      else built.push({ where: at(n), parts });
    };

    // Local helpers: `const k = (key: string, …) => t(\`prefix.${key}\`, …)`.
    const helpers = new Map<string, { prefix: string; suffix: string }>();
    const isT = (callee: ts.Expression) =>
      (ts.isIdentifier(callee) && callee.text === 't') || (ts.isPropertyAccessExpression(callee) && callee.name.text === 't');
    const tArgs = new Set<ts.Node>();

    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && isT(n.expression) && n.arguments.length) {
        const arg = n.arguments[0];
        tArgs.add(arg);
        const kind: Use['kind'] = n.arguments[1] && /returnObjects/.test(n.arguments[1].getText(sf)) ? 'objects' : 'key';
        if (ts.isArrayLiteralExpression(arg)) {
          for (const el of arg.elements) {
            tArgs.add(el);
            const v = literalOf(el as ts.Expression);
            if (v !== null) keys.push({ where: at(el), key: v, kind });
          }
        } else {
          const parts = partsOf(arg);
          const open = parts.filter((p) => 'open' in p) as { open: string }[];
          let fn: ts.Node | undefined = n.parent;
          while (fn && !ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn) && !ts.isFunctionDeclaration(fn)) fn = fn.parent;
          const fnName =
            fn && ts.isFunctionDeclaration(fn) && fn.name
              ? fn.name.text
              : fn && fn.parent && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)
                ? fn.parent.name.text
                : null;
          const firstParam =
            fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn)) && fn.parameters[0]
              ? fn.parameters[0].name.getText(sf)
              : null;
          if (open.length === 1 && fnName && firstParam === open[0].open && parts.every((p) => !('alts' in p))) {
            const i = parts.findIndex((p) => 'open' in p);
            const lits = (ps: Part[]) => ps.map((p) => ('lit' in p ? p.lit : '')).join('');
            helpers.set(fnName, { prefix: lits(parts.slice(0, i)), suffix: lits(parts.slice(i + 1)) });
          } else record(parts, arg, kind);
        }
      }
      if (ts.isJsxAttribute(n) && n.name.getText(sf) === 'i18nKey' && n.initializer) {
        const e = ts.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer;
        if (e) {
          tArgs.add(e);
          record(partsOf(e as ts.Expression), e, 'key');
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);

    // The calls of the helpers found above, and the literals that name a key.
    const visit2 = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && helpers.has(n.expression.text) && n.arguments.length) {
        const h = helpers.get(n.expression.text)!;
        const arg = n.arguments[0];
        tArgs.add(arg);
        record([{ lit: h.prefix }, ...partsOf(arg), { lit: h.suffix }], arg, 'key');
      } else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !tArgs.has(n)) {
        const s = n.text;
        const parent = n.parent;
        // `labelKey: 'x.y'`: a property named for a key holds a whole key,
        // whatever its namespace (`severities.critical` named none, and the
        // container tables printed their English default for two years).
        if (
          parent &&
          ts.isPropertyAssignment(parent) &&
          parent.initializer === n &&
          LABEL_KEY_PROPERTY.test(parent.name.getText(sf)) &&
          /^[A-Za-z_][\w-]*(\.[\w-]+)+$/.test(s)
        ) {
          strays.push({ where: at(n), key: s, kind: 'objects' });
        }
        const inImport = parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent));
        // A full key: a known namespace and at least two dots (`common.x` alone
        // is often a relative suffix completed elsewhere).
        if (!inImport && /^[A-Za-z_][\w-]*(\.[\w-]+){2,}\.?$/.test(s) && namespaces.has(s.split('.')[0])) {
          strays.push({ where: at(n), key: s.replace(/\.$/, ''), kind: 'objects' });
        }
      } else if (ts.isTemplateExpression(n) && !tArgs.has(n) && namespaces.has(n.head.text.split('.')[0]) && /^[A-Za-z_][\w-]*\./.test(n.head.text)) {
        const parts = partsOf(n);
        const spelled = spell(parts);
        if (spelled) for (const key of spelled) strays.push({ where: at(n), key, kind: 'objects' });
        else built.push({ where: at(n), parts });
      }
      ts.forEachChild(n, visit2);
    };
    visit2(sf);
  }
  return { keys, strays, built };
}

/** The keys of `scan` that no dictionary of `dicts` can render, as `<lng> <where> → <key>`. */
export function missingKeys(scan: KeyScan, dicts: Record<Lang, Dict>): string[] {
  const missing: string[] = [];
  for (const use of scan.keys) {
    for (const lng of LANGS) {
      const ok = use.kind === 'objects' ? nodeAt(dicts[lng], use.key) !== undefined : isLeaf(dicts[lng], use.key);
      if (!ok) missing.push(`${lng} ${use.where} → ${use.key}`);
    }
  }
  for (const use of scan.strays) {
    for (const lng of LANGS) {
      if (!isLeaf(dicts[lng], use.key) && !isNode(dicts[lng], use.key)) missing.push(`${lng} ${use.where} → ${use.key}`);
    }
  }
  return [...new Set(missing)];
}

/** The literal prefixes of keys built at runtime that no dictionary holds, as `<lng> <where> → <prefix>.*`. */
export function missingPrefixes(scan: KeyScan, dicts: Record<Lang, Dict>, namespaces: ReadonlySet<string>): string[] {
  const missing: string[] = [];
  for (const { where, parts } of scan.built) {
    const first = parts[0];
    if (!first || !('lit' in first) || !first.lit.includes('.')) continue;
    const prefix = first.lit.slice(0, first.lit.lastIndexOf('.'));
    if (!namespaces.has(prefix.split('.')[0])) continue;
    for (const lng of LANGS) if (!isNode(dicts[lng], prefix)) missing.push(`${lng} ${where} → ${prefix}.*`);
  }
  return [...new Set(missing)];
}
