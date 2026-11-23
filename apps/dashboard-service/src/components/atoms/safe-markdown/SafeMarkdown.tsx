import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SafeNavigator } from '@/utils/hooks/useSafeNavigate';
import { isSafeExternalUrl } from '@/utils/function/safeUrl';

export type SafeMarkdownLinkTone = 'violet' | 'accent';

interface SafeMarkdownProps {
  content: string;
  className?: string;
  components?: Components;
  /**
   * `violet` (default) keeps the fixed violet of the Cybe chat. `accent` uses
   * the `secondary` token, which follows `data-product` (the product space).
   */
  linkTone?: SafeMarkdownLinkTone;
}

/** The class of a rendered link, by tone. Only the look changes, never the link logic. */
const LINK_CLASSES: Record<SafeMarkdownLinkTone, string> = {
  violet: 'text-violet-600 hover:text-violet-800 dark:text-violet-300 underline decoration-dotted',
  accent: 'text-secondary hover:underline dark:text-secondary-light',
};

/** The class of a table row, by tone. */
const ROW_CLASSES: Record<SafeMarkdownLinkTone, string> = {
  violet:
    'odd:bg-white even:bg-gray-50 dark:odd:bg-neutral-900/40 dark:even:bg-neutral-800/40 hover:bg-violet-50/60 dark:hover:bg-violet-900/20 transition-colors',
  accent:
    'odd:bg-white even:bg-gray-50 dark:odd:bg-neutral-900/40 dark:even:bg-neutral-800/40 hover:bg-secondary/5 transition-colors',
};

/**
 * A slash or a backslash, raw or percent-encoded (any case), right after the
 * leading slash. A browser reads `//host` and `/\host` as another host; the
 * encoded forms become one as soon as anything decodes the path.
 */
const SECOND_CHARACTER_SLASH = /^\/(?:[/\\]|%2f|%5c)/i;
/**
 * C0 control characters, space and DEL. A browser strips tabs and line breaks
 * from a URL, so `/<TAB>/host` is read as `//host`; a path the application
 * writes never holds any of them.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f]/;

/**
 * True for a path of this origin, the only kind of href rendered as an
 * in-app link. The content is LLM output (chat answers), and an internal link
 * React Router cannot push falls back to `window.location.assign`, so this
 * predicate is what keeps such a link inside the application.
 */
export const isSafeInternalPath = (href: string): boolean => {
  if (href.length === 0 || href.length > 2048) return false;
  if (!href.startsWith('/')) return false;
  if (SECOND_CHARACTER_SLASH.test(href)) return false;
  if (CONTROL_OR_SPACE.test(href)) return false;
  // Every URL scheme contains ':' (e.g. 'javascript:', 'data:',
  // 'mailto:', 'http:'). A scheme-less path-only href has no ':' at all,
  // so this rule is sufficient to block every outbound scheme.
  if (href.includes(':')) return false;
  return true;
};

/**
 * Layout defaults applied to every Markdown render. These keep code blocks,
 * tables, and long words from breaking out of their parent (most chat
 * bubbles cap themselves at `max-w-[85%]`, which only works if the rendered
 * descendants respect that bound). Consumers can still override any entry —
 * the security-critical components in {@link lockedComponents} take final
 * precedence below.
 */
const defaultComponents: Components = {
  pre: ({ children, ...rest }) => (
    <pre
      {...rest}
      className="my-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-neutral-900/90 p-3 text-xs text-neutral-100 dark:bg-neutral-800"
    >
      {children}
    </pre>
  ),
  code: ({ children, className, ...rest }) => {
    // react-markdown invokes this for both fenced blocks (wrapped in <pre>)
    // and inline `code`. The fenced path keeps the upstream className (e.g.
    // `language-ts`); inline usage has none — we only restyle the inline
    // path so the block inherits the <pre> background instead of stacking
    // two backgrounds.
    if (className) {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-neutral-200 px-1 py-0.5 text-[12px] break-words dark:bg-neutral-700"
        {...rest}
      >
        {children}
      </code>
    );
  },
  table: ({ children, ...rest }) => (
    <div className="my-2 max-w-full overflow-x-auto rounded-md border border-gray-200 dark:border-neutral-700">
      <table
        {...rest}
        className="w-full border-collapse text-left text-[12px]"
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...rest }) => (
    <thead
      {...rest}
      className="bg-gray-100 dark:bg-neutral-800/80 text-[11px] uppercase tracking-wider text-gray-600 dark:text-gray-300"
    >
      {children}
    </thead>
  ),
  tbody: ({ children, ...rest }) => (
    <tbody
      {...rest}
      className="divide-y divide-gray-200 dark:divide-neutral-700"
    >
      {children}
    </tbody>
  ),
  tr: ({ children, ...rest }) => (
    <tr {...rest} className={ROW_CLASSES.violet}>
      {children}
    </tr>
  ),
  th: ({ children, ...rest }) => (
    <th
      {...rest}
      className="border-b border-gray-200 dark:border-neutral-700 px-3 py-2 font-semibold align-middle"
    >
      {children}
    </th>
  ),
  td: ({ children, ...rest }) => (
    <td
      {...rest}
      className="border-b border-gray-100 dark:border-neutral-800 px-3 py-2 align-top text-gray-800 dark:text-gray-200 break-words"
    >
      {children}
    </td>
  ),
  // `a` is overridden inside the component with a navigation-aware version
  // (see `buildAnchorRenderer`). The module-level default keeps the safe
  // fallback for any callsite that ever bypasses the locked override.
  a: ({ children }) => <span>{children}</span>,
  p: ({ children, ...rest }) => (
    <p {...rest} className="break-words">
      {children}
    </p>
  ),
};

/**
 * Build an anchor renderer bound to the supplied router navigator.
 *
 * - Internal hrefs (validated by {@link isSafeInternalPath}) render as a
 *   real `<a href="/...">` so screen-readers and middle-click + open-in-new-tab
 *   still work, but click events are intercepted and dispatched via
 *   `react-router-dom`'s `navigate()` — preserving SPA state instead of
 *   triggering a full page reload.
 * - Safe external http(s) hrefs (validated by {@link isSafeExternalUrl})
 *   render as a real `<a target="_blank" rel="noreferrer noopener nofollow">`
 *   so documentation / source links (e.g. `https://docs.cybedefend.com/...`)
 *   are clickable and open in a new tab without leaking `window.opener` or
 *   the referrer.
 * - Anything else (javascript:, data:, mailto:, protocol-relative, relative
 *   path, …) degrades to a plain `<span>` to maintain the strict XSS
 *   hardening contract from the link whitelist.
 */
const buildAnchorRenderer = (
  navigate: (path: string) => void,
  linkClassName: string = LINK_CLASSES.violet,
): Components['a'] => {
  return ({ href, children, ...rest }) => {
    if (typeof href === 'string' && isSafeInternalPath(href)) {
      const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        // Honour modifier keys / non-left clicks so the browser can still
        // open the same URL in a new tab when the user explicitly asks.
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        ) {
          return;
        }
        e.preventDefault();
        navigate(href);
      };
      return (
        <a
          {...rest}
          href={href}
          onClick={handleClick}
          className={linkClassName}
        >
          {children}
        </a>
      );
    }
    if (typeof href === 'string' && isSafeExternalUrl(href)) {
      // External links open in a new tab and are owned by the browser (no
      // SPA navigate handler). `noopener`/`noreferrer` sever the
      // `window.opener` channel and the referrer leak; `nofollow` avoids
      // vouching for arbitrary LLM-surfaced destinations.
      return (
        <a
          {...rest}
          href={href}
          target="_blank"
          rel="noreferrer noopener nofollow"
          className={linkClassName}
        >
          {children}
        </a>
      );
    }
    return <span>{children}</span>;
  };
};

const buildLockedComponents = (
  navigate: (path: string) => void,
  linkClassName?: string,
): Components => ({
  // Anchor links are validated by isSafeInternalPath — only clean internal
  // pathnames render as <a>; everything else degrades to a plain <span>.
  // Keeping `a` here ensures consumers cannot override this security boundary.
  a: buildAnchorRenderer(navigate, linkClassName),
  img: () => null,
  iframe: () => null,
  script: () => null,
  style: () => null,
  form: () => null,
});

/** The accent tone only restyles the table rows; the rest of the defaults stay. */
const accentComponents: Components = {
  tr: ({ children, ...rest }) => (
    <tr {...rest} className={ROW_CLASSES.accent}>
      {children}
    </tr>
  ),
};

const SafeMarkdown: React.FC<SafeMarkdownProps> = ({ content, className, components, linkTone = 'violet' }) => {
  // `SafeNavigator` handles both in-router (the app)
  // and standalone (Storybook/tests) cases via a Rules-of-Hooks-safe split.
  return (
    <SafeNavigator>
      {(navigate) => {
        const merged: Components = {
          ...defaultComponents,
          ...(linkTone === 'accent' ? accentComponents : {}),
          ...(components || {}),
          ...buildLockedComponents(navigate, LINK_CLASSES[linkTone]),
        };
        return (
          <div className={className}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={merged}>
              {content ?? ''}
            </ReactMarkdown>
          </div>
        );
      }}
    </SafeNavigator>
  );
};

export default SafeMarkdown;
