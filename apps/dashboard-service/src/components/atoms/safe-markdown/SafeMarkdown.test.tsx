import React from 'react';
import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import SafeMarkdown, { isSafeInternalPath } from './SafeMarkdown';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('SafeMarkdown', () => {
  it('renders plain text', () => {
    const { container } = render(<SafeMarkdown content="hello world" />);
    expect(container.textContent).toContain('hello world');
  });

  it('renders **bold** as <strong>', () => {
    const { container } = render(<SafeMarkdown content="**bold text**" />);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('bold text');
  });

  it('renders _em_ as <em>', () => {
    const { container } = render(<SafeMarkdown content="_italic_" />);
    const em = container.querySelector('em');
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe('italic');
  });

  it('renders an unordered list', () => {
    const { container } = render(<SafeMarkdown content={'- a\n- b'} />);
    const ul = container.querySelector('ul');
    expect(ul).not.toBeNull();
    const items = container.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('a');
    expect(items[1].textContent).toBe('b');
  });

  it('renders a fenced code block as <pre><code>', () => {
    const md = '```\nconst x = 1;\n```';
    const { container } = render(<SafeMarkdown content={md} />);
    const pre = container.querySelector('pre');
    const code = container.querySelector('pre code');
    expect(pre).not.toBeNull();
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain('const x = 1;');
  });

  it('renders external https markdown links as clickable new-tab anchors', () => {
    const { container } = render(<SafeMarkdown content="[click here](https://example.com)" />);
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a).toHaveAttribute('href', 'https://example.com');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a?.getAttribute('rel') ?? '').toContain('noopener');
    expect(a?.getAttribute('rel') ?? '').toContain('noreferrer');
    expect(container.textContent).toContain('click here');
  });

  it('strips javascript: links: [x](javascript:alert(1)) is inert', () => {
    const { container } = render(<SafeMarkdown content="[x](javascript:alert(1))" />);
    expect(container.textContent).toContain('x');
    expect(container.querySelector('a')).toBeNull();
    expect(container.innerHTML.toLowerCase()).not.toContain('javascript:');
    expect(container.innerHTML).not.toContain('alert(1)');
  });

  it('does not execute <script> tags from the input — they are escaped, not rendered', () => {
    const { container } = render(<SafeMarkdown content={'<script>alert(1)</script>'} />);
    expect(container.querySelector('script')).toBeNull();
  });

  it('does not render <img> from raw HTML — escaped only', () => {
    const { container } = render(<SafeMarkdown content={'<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    container.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        expect(attr.name.toLowerCase()).not.toMatch(/^on/);
      });
    });
  });

  it('does not render <img> from markdown image syntax', () => {
    const { container } = render(<SafeMarkdown content={'![alt text](http://evil/x.png)'} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('honors consumer-provided components.code override', () => {
    const { container } = render(
      <SafeMarkdown
        content="`inline code`"
        components={{
          code: ({ children }) => <code data-testid="custom-code">{children}</code>,
        }}
      />,
    );
    expect(container.querySelector('[data-testid="custom-code"]')).not.toBeNull();
  });

  it('IGNORES consumer attempts to override anchor — external links use the locked safe renderer', () => {
    const { container } = render(
      <SafeMarkdown
        content="[click](https://example.com)"
        components={{
          a: ({ children, ...rest }: any) => (
            <a href={rest.href} data-testid="custom-anchor">
              {children}
            </a>
          ),
        }}
      />,
    );
    // The consumer override never wins the security boundary…
    expect(container.querySelector('[data-testid="custom-anchor"]')).toBeNull();
    // …but the locked renderer still produces a safe new-tab anchor.
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a).toHaveAttribute('target', '_blank');
    expect(a?.getAttribute('rel') ?? '').toContain('noopener');
    expect(container.textContent).toContain('click');
  });

  it('renders GFM tables (remark-gfm enabled)', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |';
    const { container } = render(<SafeMarkdown content={md} />);
    expect(container.querySelector('table')).not.toBeNull();
  });

  it('renders empty content without crashing', () => {
    const { container } = render(<SafeMarkdown content="" />);
    expect(container).toBeTruthy();
  });

  it('applies the wrapper className', () => {
    const { container } = render(<SafeMarkdown content="x" className="my-wrapper" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('my-wrapper');
  });

  it('constrains code blocks so they do not overflow their parent', () => {
    const md = '```\nthis is a really really really really really long code line\n```';
    const { container } = render(<SafeMarkdown content={md} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    const cls = pre?.className ?? '';
    // Defence in depth: scroll OR wrap, both prevent the content from
    // visually escaping a fixed-width parent.
    expect(cls).toMatch(/overflow-x-auto/);
    expect(cls).toMatch(/max-w-full/);
  });

  it('wraps tables so wide grids scroll horizontally instead of overflowing', () => {
    const md = '| a | b | c | d | e | f |\n|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 |';
    const { container } = render(<SafeMarkdown content={md} />);
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    const wrapper = table?.parentElement;
    expect(wrapper?.className ?? '').toMatch(/overflow-x-auto/);
  });

  it('styles table cells with borders and padding so the grid is legible', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |';
    const { container } = render(<SafeMarkdown content={md} />);
    const table = container.querySelector('table');
    const th = container.querySelector('th');
    const td = container.querySelector('td');
    expect(table?.className ?? '').toMatch(/border/);
    expect(th?.className ?? '').toMatch(/border/);
    expect(th?.className ?? '').toMatch(/px-/);
    expect(td?.className ?? '').toMatch(/border/);
    expect(td?.className ?? '').toMatch(/px-/);
  });

  it('gives the table header a distinguishable background', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |';
    const { container } = render(<SafeMarkdown content={md} />);
    const thead = container.querySelector('thead');
    expect(thead?.className ?? '').toMatch(/bg-/);
  });

  it('zebra-stripes body rows for readability', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';
    const { container } = render(<SafeMarkdown content={md} />);
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    // At least one row should advertise a striped/odd background hook so
    // tailwind variants like ``odd:bg-…`` or ``even:bg-…`` can flag rows
    // visually distinct from each other.
    const haveStripes = Array.from(rows).some((r) =>
      /odd:bg-|even:bg-/.test(r.className),
    );
    expect(haveStripes).toBe(true);
  });

  it('lets a consumer override the pre default (security wrappers still apply)', () => {
    const md = '```\nhello\n```';
    const { container } = render(
      <SafeMarkdown
        content={md}
        components={{
          pre: ({ children }) => <pre data-testid="custom-pre">{children}</pre>,
        }}
      />,
    );
    expect(container.querySelector('[data-testid="custom-pre"]')).not.toBeNull();
  });
});

describe('SafeMarkdown internal link whitelist', () => {
    beforeEach(() => {
        mockNavigate.mockReset();
    });

    it('renders internal path links as in-app anchors that trigger SPA navigation on click', () => {
        render(
            <MemoryRouter>
                <SafeMarkdown content="[Vuln](/project/p1/sast/issue/v42)" />
            </MemoryRouter>,
        );
        const link = screen.getByRole('link', { name: 'Vuln' });
        expect(link).toHaveAttribute('href', '/project/p1/sast/issue/v42');
        // Internal links MUST NOT open a new tab — that would break SPA state.
        expect(link).not.toHaveAttribute('target', '_blank');
        // Clicking dispatches via useNavigate, not a full page load.
        fireEvent.click(link);
        expect(mockNavigate).toHaveBeenCalledWith('/project/p1/sast/issue/v42');
    });

    it('renders external https links as clickable new-tab anchors', () => {
        render(<SafeMarkdown content="[Site](https://example.com/path)" />);
        const link = screen.getByRole('link', { name: 'Site' });
        expect(link).toHaveAttribute('href', 'https://example.com/path');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link.getAttribute('rel') ?? '').toContain('noopener');
        expect(link.getAttribute('rel') ?? '').toContain('noreferrer');
    });

    it('renders external http links as clickable new-tab anchors', () => {
        render(<SafeMarkdown content="[Site](http://example.org)" />);
        const link = screen.getByRole('link', { name: 'Site' });
        expect(link).toHaveAttribute('href', 'http://example.org');
        expect(link).toHaveAttribute('target', '_blank');
    });

    it('renders a docs.cybedefend.com link as a clickable anchor', () => {
        render(
            <SafeMarkdown content="[Documentation détaillée](https://docs.cybedefend.com/guide/sast)" />,
        );
        const link = screen.getByRole('link', { name: 'Documentation détaillée' });
        expect(link).toHaveAttribute(
            'href',
            'https://docs.cybedefend.com/guide/sast',
        );
        expect(link).toHaveAttribute('target', '_blank');
    });

    it('does NOT intercept external link clicks for SPA navigation', () => {
        render(<SafeMarkdown content="[Site](https://docs.cybedefend.com)" />);
        const link = screen.getByRole('link', { name: 'Site' });
        expect(link).toHaveAttribute('target', '_blank');
        const clickEvent = createEvent.click(link, { button: 0 });
        fireEvent(link, clickEvent);
        // Unlike internal links, the external branch attaches NO click handler:
        // the default action is left to the browser (defaultPrevented stays
        // false) and the in-app router navigate() never fires.
        expect(clickEvent.defaultPrevented).toBe(false);
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('intercepts internal link clicks (preventDefault + SPA navigate) — contrast', () => {
        render(
            <MemoryRouter>
                <SafeMarkdown content="[Vuln](/project/p1/sast/issue/v9)" />
            </MemoryRouter>,
        );
        const link = screen.getByRole('link', { name: 'Vuln' });
        const clickEvent = createEvent.click(link, { button: 0 });
        fireEvent(link, clickEvent);
        // The internal branch DOES intercept: it prevents the full reload and
        // routes through navigate().
        expect(clickEvent.defaultPrevented).toBe(true);
        expect(mockNavigate).toHaveBeenCalledWith('/project/p1/sast/issue/v9');
    });

    it('renders ftp links as plain text (only http/https are clickable)', () => {
        render(<SafeMarkdown content="[FTP](ftp://files.example.com/x)" />);
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('FTP')).toBeInTheDocument();
    });

    it('renders protocol-relative links as plain text', () => {
        render(<SafeMarkdown content="[Evil](//evil.com/x)" />);
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('Evil')).toBeInTheDocument();
    });

    it('renders javascript: hrefs as plain text', () => {
        render(<SafeMarkdown content="[XSS](javascript:alert(1))" />);
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('XSS')).toBeInTheDocument();
    });

    it('renders data: hrefs as plain text', () => {
        render(
            <SafeMarkdown content="[X](data:text/html,<script>alert(1)</script>)" />,
        );
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('X')).toBeInTheDocument();
    });

    it('renders mailto: hrefs as plain text', () => {
        render(<SafeMarkdown content="[Mail](mailto:foo@bar.com)" />);
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('Mail')).toBeInTheDocument();
    });

    it('renders relative paths (no leading slash) as plain text', () => {
        render(<SafeMarkdown content="[Rel](foo/bar)" />);
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('Rel')).toBeInTheDocument();
    });

    it('preserves query strings on internal paths', () => {
        render(
            <MemoryRouter>
                <SafeMarkdown content="[Q](/project/p1?tab=overview)" />
            </MemoryRouter>,
        );
        const link = screen.getByRole('link', { name: 'Q' });
        expect(link).toHaveAttribute('href', '/project/p1?tab=overview');
    });

    it('preserves fragments on internal paths', () => {
        render(
            <MemoryRouter>
                <SafeMarkdown content="[F](/project/p1#section)" />
            </MemoryRouter>,
        );
        const link = screen.getByRole('link', { name: 'F' });
        expect(link).toHaveAttribute('href', '/project/p1#section');
    });

    it('rejects overly long hrefs (>2048 chars)', () => {
        const longHref = '/' + 'a'.repeat(2048);
        render(<SafeMarkdown content={`[Long](${longHref})`} />);
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('Long')).toBeInTheDocument();
    });

    it('renders empty hrefs as plain text', () => {
        render(<SafeMarkdown content="[Empty]()" />);
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('Empty')).toBeInTheDocument();
    });

    it('does NOT mark internal links as new-tab targets (SPA navigation only)', () => {
        render(
            <MemoryRouter>
                <SafeMarkdown content="[Rel](/project/p1/sast/issue/v1)" />
            </MemoryRouter>,
        );
        const link = screen.getByRole('link', { name: 'Rel' });
        expect(link).not.toHaveAttribute('target', '_blank');
    });
});

/**
 * A chat answer is LLM output. An internal link must stay a path of this
 * origin: a browser reads `//host` and `/\host` as another host, and an
 * internal link that React Router cannot push falls back to a full
 * `window.location.assign`, so such a href would leave the application.
 */
describe('SafeMarkdown internal links never leave the application', () => {
    beforeEach(() => {
        mockNavigate.mockReset();
    });

    it.each([
        ['a backslash second', '/\\evil.example'],
        ['an escaped slash that becomes //', '/\\/evil.example'],
        ['%5C second', '/%5Cevil.example'],
        ['%5c second', '/%5cevil.example'],
        ['%2F second', '/%2Fevil.example'],
        ['%2f second', '/%2fevil.example'],
    ])('renders a link with %s as plain text', (_label, href) => {
        render(
            <MemoryRouter>
                <SafeMarkdown content={`[Evil](${href})`} />
            </MemoryRouter>,
        );
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('Evil')).toBeInTheDocument();
    });

    it('keeps an encoded slash further down the path a link', () => {
        render(
            <MemoryRouter>
                <SafeMarkdown content="[Vuln](/appsec/project/p%2F1/sast?issue=v%2F1#h)" />
            </MemoryRouter>,
        );
        expect(screen.getByRole('link', { name: 'Vuln' })).toHaveAttribute(
            'href',
            '/appsec/project/p%2F1/sast?issue=v%2F1#h',
        );
    });
});

/**
 * Markdown percent-encodes a raw backslash or control character before the
 * renderer sees it; the predicate is the boundary all the same, so it is
 * checked on the raw forms too.
 */
describe('isSafeInternalPath', () => {
    it.each([
        '//evil.example',
        '/\\evil.example',
        '/%2fevil.example',
        '/%2Fevil.example',
        '/%5cevil.example',
        '/%5Cevil.example',
        // A browser strips tabs and line breaks from a URL: these read as //evil.example.
        '/\t/evil.example',
        '/\n/evil.example',
        '/\r/evil.example',
        '/\u0000/evil.example',
        'javascript:alert(1)',
        '/redirect:https://evil.example',
        'https://evil.example',
        'evil.example',
        '',
    ])('refuses %j', (href) => {
        expect(isSafeInternalPath(href)).toBe(false);
    });

    it.each(['/', '/appsec', '/appsec/project/p%2F1/sast?issue=v%2F1#h', '/project/p1/sast/issue/v42'])(
        'accepts %j',
        (href) => {
            expect(isSafeInternalPath(href)).toBe(true);
        },
    );
});

/**
 * The Cybe chat keeps its violet links; a page of a product space asks for `linkTone="accent"` and gets the `secondary` token, which
 * follows `data-product`.
 */
describe('SafeMarkdown — linkTone', () => {
    const table = '| a |\n| - |\n| 1 |';

    it('keeps the violet links and row hover by default', () => {
        const { container } = render(
            <MemoryRouter>
                <SafeMarkdown content={`[doc](https://docs.cybedefend.com) [in](/appsec)\n\n${table}`} />
            </MemoryRouter>,
        );
        const links = container.querySelectorAll('a');
        expect(links).toHaveLength(2);
        links.forEach((link) => {
            expect(link).toHaveClass('text-violet-600', 'hover:text-violet-800', 'dark:text-violet-300', 'underline');
            expect(link).not.toHaveClass('text-secondary');
        });
        expect(container.querySelector('tbody tr')).toHaveClass('hover:bg-violet-50/60', 'dark:hover:bg-violet-900/20');
    });

    it('uses the accent token for links and row hover when linkTone is accent', () => {
        const { container } = render(
            <MemoryRouter>
                <SafeMarkdown
                    linkTone="accent"
                    content={`[doc](https://docs.cybedefend.com) [in](/appsec)\n\n${table}`}
                />
            </MemoryRouter>,
        );
        const links = container.querySelectorAll('a');
        expect(links).toHaveLength(2);
        links.forEach((link) => {
            expect(link).toHaveClass('text-secondary', 'hover:underline', 'dark:text-secondary-light');
            expect(link.className).not.toMatch(/violet/);
        });
        const row = container.querySelector('tbody tr');
        expect(row).toHaveClass('hover:bg-secondary/5');
        expect(row?.className).not.toMatch(/violet/);
    });

    it('still degrades an unsafe link to a span with the accent tone', () => {
        const { container } = render(
            <MemoryRouter>
                <SafeMarkdown linkTone="accent" content="[x](javascript:alert(1))" />
            </MemoryRouter>,
        );
        expect(container.querySelector('a')).toBeNull();
        expect(container.textContent).toContain('x');
    });
});
