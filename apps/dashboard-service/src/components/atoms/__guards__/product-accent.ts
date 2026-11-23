import ts from 'typescript';
import { PRODUCTS } from '@/utils/product';

/**
 * Where a closed product space lives, what may still be a fixed violet or
 * fuchsia in it, and what accent text must carry to stay readable in the dark.
 *
 * The accent of a space is the `secondary` token, which `data-product` turns
 * violet in AppSec and neutral in another product space (`src/index.css`). A class
 * that names a fixed colour of those ramps ignores the attribute:
 *
 * - `text-violet-600`, `bg-purple-100`, `#7845FF`, `#DD50FF`: on a closed
 *   space's screen it shows the AppSec accent;
 * - `text-fuchsia-700`: it shows what that accent happens to be today, and
 *   stops following the token the day its values change.
 *
 * `product-accent.test.ts` fails when one appears in the files below.
 *
 * Paths are relative to `src/`. A directory covers everything under it. Any
 * file under `src/ee/` is covered too, without being listed, and so is any
 * path that still names a closed product: a new page or component of the
 * space is guarded from its first commit. (`src/ee/` is the closed extension
 * tree, absent from the Community Edition.)
 */
export const ACCENT_GUARDED: readonly string[] = [
  // The pages, components, data layer and utilities of the space live in the
  // closed extension tree (covered without being listed).
  // The kit the space is built from (its composites, motion, narrative palette).
  'components/molecules/kit',
  // What the shell shares with AppSec and shows on every page of the space.
  'components/molecules/sidebar',
  'components/organismes/navigation',
  'components/molecules/breadcrumbs',
  'components/molecules/project-id-actions',
  'components/molecules/wrapper/ProjectSectionNav.tsx',
  'components/molecules/wrapper/ProjectTemplateWrapper.tsx',
  // Project settings and project creation are reachable from both spaces.
  'pages/project-pages/project-setting-page',
  'components/organismes/project-settings',
  'components/molecules/modal/create-project-modal',
  // The analysis launcher another space's project page shares with the AppSec result pages.
  'components/molecules/start-analysis',
];

/** A path that names a product space other than the core's own (`ProductSpace.id`), in any case. */
const namesClosedSpace = (rel: string): boolean =>
  PRODUCTS.some((id) => id !== 'appsec' && rel.toLowerCase().includes(id.toLowerCase()));

/** True for a file of a closed product space (or of the shared shell it shows), by its path relative to `src/`. */
export const isAccentGuarded = (rel: string): boolean =>
  // The guard's own list quotes the colours it forbids.
  !rel.startsWith('components/atoms/__guards__/') &&
  // The chat (closed extension) renders in the AppSec shell only, so its
  // fixed violet is the AppSec accent, never a closed space's screen.
  !rel.startsWith('ee/chat/') &&
  (rel.startsWith('ee/') ||
    namesClosedSpace(rel) ||
    ACCENT_GUARDED.some((entry) => rel === entry || rel.startsWith(`${entry}/`)));

/**
 * A class of Tailwind's violet, purple or fuchsia ramp, with any variant or
 * opacity, or one of the two brand colours as a literal.
 */
const FIXED_ACCENT = /\b(?:violet|purple|fuchsia)-(?:50|[1-9]00|950)\b|#7845FF|#DD50FF/gi;

const TOKEN_HINT =
  '  ↳ use the token instead: text-secondary dark:text-secondary-light, bg-secondary/10, border-secondary/20';

interface GuardReport {
  regressions: string[];
  paidOff: string[];
}

/** What was found in one file, against what that file is allowed. */
function againstAllowance(rel: string, found: string[], allowance: number, hint: string): GuardReport {
  if (found.length > allowance) {
    return {
      regressions: [...found, allowance === 0 ? hint : `  ↳ src/${rel} is allowed ${allowance}, has ${found.length}`],
      paidOff: [],
    };
  }
  return {
    regressions: [],
    paidOff: found.length < allowance ? [`src/${rel} — ${allowance} → ${found.length}`] : [],
  };
}

/**
 * What the guard says about one file: `regressions` when it names more fixed
 * accent colours than its allowance (each with its file, line and class, then
 * what to write instead), `paidOff` when it needs less than it is allowed.
 */
export function fixedAccentReport(rel: string, source: string, allowance: number): GuardReport {
  const found = source
    .split('\n')
    .flatMap((line, index) => [...line.matchAll(FIXED_ACCENT)].map((match) => `src/${rel}:${index + 1} — ${match[0]}`));

  return againstAllowance(rel, found, allowance, TOKEN_HINT);
}

/**
 * Fixed colours that stay, each with its reason and the number of class names
 * it covers. Not a permission list: a count may shrink, never grow, and an
 * entry that is no longer needed must be removed (the test says so).
 */
export const FIXED_ACCENT_ALLOWED: ReadonlyArray<{
  file: string;
  count: number;
  reason: string;
}> = [
  {
    file: 'ee/ai/components/atoms/badge/AIBadges.tsx',
    count: 24,
    reason:
      'The former tinted analysis pills, unchanged: rendered nowhere since the quiet tags replaced them, never in another product space.',
  },
  {
    file: 'ee/advisories/ContextualBadges.tsx',
    count: 4,
    reason:
      'The EPSS contextual badges, unchanged: rendered nowhere but their test, and the token would change its colour in another product space.',
  },
  {
    file: 'ee/aibom/pages/ai-bom-page/AiBomComponentDetails.tsx',
    count: 4,
    reason:
      'The symbol pill of an AI-BOM occurrence, unchanged: the page is AppSec\'s only, and the token would change its colour in another product space.',
  },
  {
    file: 'ee/codemap/components/molecules/project-overview/SupportedLanguagesNotice.tsx',
    count: 4,
    reason:
      'The code map\'s « supported languages » notice, unchanged: the token would change its colour in another product space.',
  },
];

/**
 * `text-secondary` as a class of its own, with or without an opacity. Not its
 * light shade, and not behind a variant (`hover:`, `focus:`, `group-hover:`):
 * a state colour is not what the text reads in at rest.
 */
const BARE_ACCENT_TEXT = /(?<![\w:/-])text-secondary(?![\w-])/;

/** The text colour of the dark theme, whichever it is. */
const DARK_TEXT = /(?<![\w:/-])dark:text-/;

const COMPANION_HINT =
  '  ↳ accent text needs its dark companion in the same class string: text-secondary dark:text-secondary-light';

type StaticPart = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail;

/** The written parts of a string of the source, without what its `${…}` insert. */
function staticParts(node: ts.Node): StaticPart[] | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node];
  if (ts.isTemplateExpression(node)) return [node.head, ...node.templateSpans.map((span) => span.literal)];
  return null;
}

/**
 * What the guard says about the accent text of one file.
 *
 * On a dark surface the `secondary` token is the shade meant for fills and
 * graphics (`src/index.css`): as text it is under WCAG AA there, about 3.8:1 on
 * the cards of the dark theme. Accent text therefore names its
 * dark colour itself, `text-secondary dark:text-secondary-light`, and a class
 * string that holds the first without any `dark:text-…` is reported with its
 * file and line.
 *
 * A class string is one string of the source. Strings are read from the syntax
 * tree, so a comment or an apostrophe in a sentence is never mistaken for one,
 * and each branch of a condition answers for itself. A string written inside
 * the `${…}` of a template is covered by the `dark:text-…` of that template:
 * both end up in the class of the same element. That cover stops at an element
 * or a function written in between.
 */
export function darkCompanionReport(rel: string, source: string, allowance: number): GuardReport {
  const file = ts.createSourceFile(
    rel,
    source,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];

  const visit = (node: ts.Node, coveredAbove: boolean): void => {
    let covered = coveredAbove;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isFunctionLike(node)) covered = false;

    const parts = staticParts(node);
    if (parts) {
      const hasDarkText = parts.some((part) => DARK_TEXT.test(part.text));
      if (!covered && !hasDarkText) {
        for (const part of parts) {
          const at = part.getText(file).search(BARE_ACCENT_TEXT);
          if (at === -1) continue;
          const { line } = file.getLineAndCharacterOfPosition(part.getStart(file) + at);
          found.push(`src/${rel}:${line + 1} — text-secondary`);
          break;
        }
      }
      covered = covered || hasDarkText;
    }
    ts.forEachChild(node, (child) => visit(child, covered));
  };
  visit(file, false);

  return againstAllowance(rel, found, allowance, COMPANION_HINT);
}

/**
 * Accent classes that stay without a dark companion, each with its reason and
 * the number of class strings it covers. Like `FIXED_ACCENT_ALLOWED`: a count
 * may shrink, never grow, and an entry no longer needed must be removed.
 */
export const DARK_COMPANION_ALLOWED: ReadonlyArray<{
  file: string;
  count: number;
  reason: string;
}> = [
  {
    file: 'components/molecules/sidebar/sidebar-content/SidebarContent.tsx',
    count: 2,
    reason:
      'Two icons (the cog of the settings menu, the building of the organisation button) on the sidebar, which is dark in both themes (`data-surface="dark"` in Sidebar.tsx and Header.tsx). The token is already its dark-surface shade there, the one meant for graphics (3:1), and `dark:` would follow the theme, not the surface.',
  },
  {
    file: 'ee/products/components/molecules/product-switch/ProductSwitch.tsx',
    count: 1,
    reason:
      'The mark of the idle position of the product switch, in the accent of the product it leads to. The switch declares its own dark surface (`data-surface="dark"` on its group) and sits on the sidebar, dark in both themes: the token is its dark-surface shade, meant for graphics (3:1), and `dark:text-secondary-light` would turn the AppSec mark pink (#DD50FF) in the dark theme.',
  },
  {
    file: 'ee/billing/components/molecules/trial-status-widget/TrialStatusWidget.tsx',
    count: 1,
    reason:
      'An icon of a widget on the AppSec rail, which is dark in both themes (`data-surface="dark"` in Sidebar.tsx). The token is already its dark-surface shade there, the one meant for graphics (3:1).',
  },
  {
    file: 'ee/auth/pages/LoginPage.tsx',
    count: 6,
    reason:
      'A sign-in page, shown before any product space (no `data-product`, so the default accent): its accent icons and link, unchanged.',
  },
  {
    file: 'ee/auth/pages/SsoLoginPage.tsx',
    count: 2,
    reason:
      'An SSO sign-in page, shown before any product space (no `data-product`, so the default accent): its two accent icons, unchanged.',
  },
];
