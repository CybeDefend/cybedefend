import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import postcss, { type Root } from 'postcss';
import tailwindcss, { type Config } from 'tailwindcss';

/**
 * Test helpers for the accent per product space.
 *
 * jsdom neither inherits custom properties nor resolves `var()`, so the tests
 * read the stylesheet the application really ships — `src/index.css` through
 * the real Tailwind configuration — and resolve a custom property themselves:
 * the selectors are matched by jsdom, the cascade (specificity, then source
 * order) and the inheritance are the few lines below.
 */
const SERVICE_ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(SERVICE_ROOT, 'src');

// Loaded by Node, not by Vite: the configuration is CommonJS and requires its plugins.
const tailwindConfig = createRequire(import.meta.url)(
  path.join(SERVICE_ROOT, 'tailwind.config.js'),
) as Config;

/** The shape Tailwind takes for `theme.extend.colors`: a token is a value or a ramp of shades. */
type Colors = Record<string, string | Record<string, string>>;

const configFor = (classes: readonly string[], colors: Colors = {}): Config => ({
  ...tailwindConfig,
  content: [{ raw: classes.join(' ') }],
  theme: {
    ...tailwindConfig.theme,
    extend: {
      ...tailwindConfig.theme?.extend,
      colors: { ...(tailwindConfig.theme?.extend?.colors as Colors), ...colors },
    },
  },
});

const compile = async (css: string, config: Config): Promise<Root> =>
  (await postcss([tailwindcss(config)]).process(css, { from: undefined })).root;

/**
 * The stylesheet of the application, for a page that uses `classes`: the
 * core's `src/index.css` plus every stylesheet of the closed tree
 * (imported by its entry in a private build).
 */
export const compileAppCss = (classes: readonly string[] = []): Promise<Root> => {
  const eeStyles = path.join(SRC, 'ee', 'styles');
  const eeCss = fs.existsSync(eeStyles)
    ? fs
        .readdirSync(eeStyles)
        .filter((name) => name.endsWith('.css'))
        .map((name) => fs.readFileSync(path.join(eeStyles, name), 'utf8'))
        .join('\n')
    : '';
  return compile(`${fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')}\n${eeCss}`, configFor(classes));
};

/** One Tailwind layer for `classes`, optionally with some colours of the theme replaced. */
export const compileLayer = (
  layer: 'base' | 'components' | 'utilities',
  classes: readonly string[],
  colors?: Colors,
): Promise<Root> => compile(`@tailwind ${layer};`, configFor(classes, colors));

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx|css)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) acc.push(full);
  }
  return acc;
}

/** Every class-like word of the application's source that names the `secondary` token. */
export function secondaryClassesInSource(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/[^\s"'`{}()<>,;=]*secondary[^\s"'`{}()<>,;=]*/g)) {
      found.add(match[0]);
    }
  }
  return [...found].sort();
}

/** `selector → declarations`, one line per rule, at-rules included in the key. */
export function rulesBySelector(root: Root): Map<string, string> {
  const rules = new Map<string, string>();
  root.walkRules((rule) => {
    const scope = rule.parent?.type === 'atrule' ? `${rule.parent.toString().split('{')[0].trim()} ` : '';
    const body = rule.nodes.map((node) => node.toString().replace(/\s+/g, ' ')).join('; ');
    rules.set(`${scope}${rule.selector}`, body);
  });
  return rules;
}

interface PropertyRule {
  selector: string;
  specificity: number;
  order: number;
  declarations: Map<string, string>;
}

/** Ids, then classes / attributes / pseudo-classes, then elements — enough for the selectors of `index.css`. */
function specificity(selector: string): number {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
  const classes = selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g)?.length ?? 0;
  const elements =
    selector
      .replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+/g, ' ')
      .match(/[a-z][\w-]*/gi)?.length ?? 0;
  return ids * 10_000 + classes * 100 + elements;
}

function customPropertyRules(root: Root): PropertyRule[] {
  const rules: PropertyRule[] = [];
  let order = 0;
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule') return;
    const declarations = new Map<string, string>();
    rule.walkDecls(/^--/, (decl) => {
      declarations.set(decl.prop, decl.value.trim());
    });
    if (declarations.size === 0) return;
    for (const selector of rule.selectors) {
      order += 1;
      rules.push({ selector, specificity: specificity(selector), order, declarations });
    }
  });
  return rules;
}

/**
 * The computed value of a custom property on `element`, as a browser resolves
 * it: the winning declaration among the rules that match the element, its
 * `var()` references resolved on that same element, otherwise the value
 * inherited from the parent. `undefined` when nothing defines it.
 */
export function customProperty(root: Root, element: Element, name: string): string | undefined {
  const rules = customPropertyRules(root);
  const declared = (target: Element, property: string): string | undefined => {
    let winner: PropertyRule | undefined;
    for (const rule of rules) {
      if (!rule.declarations.has(property)) continue;
      let matches = false;
      try {
        matches = target.matches(rule.selector);
      } catch {
        // A selector jsdom cannot parse (a vendor pseudo-element of the base layer) matches nothing here.
      }
      if (!matches) continue;
      if (
        !winner ||
        rule.specificity > winner.specificity ||
        (rule.specificity === winner.specificity && rule.order > winner.order)
      ) {
        winner = rule;
      }
    }
    return winner?.declarations.get(property);
  };
  const computed = (target: Element, property: string): string | undefined => {
    const own = declared(target, property);
    if (own !== undefined) {
      return own.replace(/var\((--[\w-]+)\)/g, (_, reference: string) => computed(target, reference) ?? 'invalid');
    }
    return target.parentElement ? computed(target.parentElement, property) : undefined;
  };
  return computed(element, name);
}

/**
 * A document of its own, described from the root down: each level is the
 * attributes of one element, the first being `<html>`. Returns the innermost
 * element.
 */
export function elementIn(...levels: ReadonlyArray<Record<string, string>>): Element {
  const doc = document.implementation.createHTMLDocument('accent');
  let current: Element = doc.documentElement;
  levels.forEach((attributes, depth) => {
    if (depth > 0) {
      const child = doc.createElement('div');
      (depth === 1 ? doc.body : current).appendChild(child);
      current = child;
    }
    for (const [key, value] of Object.entries(attributes)) current.setAttribute(key, value);
  });
  return current;
}
