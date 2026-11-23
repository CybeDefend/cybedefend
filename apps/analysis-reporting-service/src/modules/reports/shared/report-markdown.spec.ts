import {
  analysisInlineHtml,
  clampMarkdown,
  curlyApostrophesHtml,
  latinizeReportText,
  markdownToHtml,
  plainText,
} from './report-markdown';

// Visible text of an HTML fragment: tags removed, entities decoded.
const visibleText = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

// Allowlist of the embedded fonts (latin subset).
const OUTSIDE_WHITELIST_RE =
  /[^\t\n\u0020-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u2022\u20ac\u2122]/u;

describe('report-markdown', () => {
  describe('plainText', () => {
    it('keeps what a reader sees: no backticks, no emphasis, link text only, one space', () => {
      expect(
        plainText(
          'Call  `eval()` in **handler**, *now* and _here_;\n see [the doc](https://x.io).',
        ),
      ).toBe('Call eval() in handler, now and here; see the doc.');
    });
  });

  // The apostrophe rule of every report, on rendered Markdown.
  describe('curlyApostrophesHtml', () => {
    it('curls an apostrophe between two letters of the text', () => {
      expect(
        curlyApostrophesHtml(
          markdownToHtml("The victim's browser and qs's limit."),
        ),
      ).toBe(
        '<p class="md-p">The victim&#8217;s browser and qs&#8217;s limit.</p>',
      );
    });

    it('never touches code, a tag, an attribute or a quote', () => {
      const html = markdownToHtml(
        "Use `a'b` then:\n\n```\nit's = 1\n```\n\nsay 'yes' at [the doc](https://x.io/it's).",
      );
      const out = curlyApostrophesHtml(html);
      expect(out).toContain('<code class="code-inline');
      expect(out).toContain('a&#39;b</code>');
      expect(out).toContain('it&#39;s = 1</pre>');
      expect(out).toContain('&#39;yes&#39;');
      // An attribute holds the escaped apostrophe the rule curls in text.
      expect(curlyApostrophesHtml('<a title="it&#39;s">it&#39;s</a>')).toBe(
        '<a title="it&#39;s">it&#8217;s</a>',
      );
      // A bare URL is copied as written.
      expect(
        curlyApostrophesHtml(
          '<span class="md-url">https://x.io/it&#39;s</span> it&#39;s',
        ),
      ).toBe('<span class="md-url">https://x.io/it&#39;s</span> it&#8217;s');
    });
  });

  // Long identifiers of descriptions: « `3.0.0-` / `beta.2026…` » used to
  // break at the first hyphen, leaving 6 characters at the end of a line.
  describe('markdownToHtml — long identifiers', () => {
    it('keeps a long identifier whole in a box while it fits a line, else cuts it at its separators', () => {
      expect(
        markdownToHtml(
          'Upgrade before `3.0.0-beta.20260922.9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b` compiles.',
        ),
      ).toBe(
        '<p class="md-p">Upgrade before <span class="id-box"><code class="code-inline">3.0.0<wbr><nobr>-b</nobr>eta<wbr>.20260922<wbr><span class="hex">.9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b</span></code></span> compiles.</p>',
      );
    });

    it('keeps the punctuation around it inside its box', () => {
      expect(
        markdownToHtml(
          'See `services/very/deep/monorepo/package-lock.json`, then (`registry.example.com/team/app@sha256:c335e56da2`).',
        ),
      ).toBe(
        '<p class="md-p">See <span class="id-box"><code class="code-inline">services<wbr>/very<wbr>/deep<wbr>/monorepo<wbr>/package<wbr><nobr>-l</nobr>ock<wbr>.json</code>,</span> then <span class="id-box">(<code class="code-inline">registry<wbr>.example<wbr>.com<wbr>/team<wbr>/app<wbr>@sha256:<wbr>c335e56da2</code>).</span></p>',
      );
    });

    it('escapes every piece of it', () => {
      expect(markdownToHtml('`a&b<c>/"quoted"-name/été-café.json`')).toBe(
        '<p class="md-p"><span class="id-box"><code class="code-inline">a&amp;b&lt;c&gt;<wbr>/&quot;quoted&quot;<wbr><nobr>-n</nobr>ame<wbr>/&#233;t&#233;<wbr><nobr>-c</nobr>af&#233;<wbr>.json</code></span></p>',
      );
    });

    // 24 characters or fewer, or code with spaces: the original markup.
    it('leaves a short identifier and code with spaces as they were', () => {
      expect(markdownToHtml('Use `missing-user.dockerfile` here.')).toBe(
        '<p class="md-p">Use <code class="code-inline">missing-user.dockerfile</code> here.</p>',
      );
      expect(
        markdownToHtml(
          'Run `npm install --save-dev some-long-package-name` now.',
        ),
      ).toBe(
        '<p class="md-p">Run <code class="code-inline">npm install --save-dev some-long-package-name</code> now.</p>',
      );
    });
  });

  describe('markdownToHtml', () => {
    // The short note of the agent is written by an LLM: the secrets it quotes
    // are masked as in a brief, and a link it writes is never a link.
    it('masks quoted secrets and renders links as text in an untrusted text', () => {
      const md =
        'Set `cookieSecret: "s3cr3t-session-key"`, drop Bearer abcdefghijklmnop0123456789 and mongodb://admin:hunter2pass@db:27017, see [the fix](https://evil.example/phish).';
      const html = markdownToHtml(md, { untrusted: true });
      expect(html).not.toContain('s3cr3t-session-key');
      expect(html).not.toContain('abcdefghijklmnop0123456789');
      expect(html).not.toContain('hunter2pass');
      expect(html).not.toContain('href=');
      expect(html).toContain('see the fix.');
      // A trusted text keeps its link.
      expect(markdownToHtml('see [the fix](https://x.io/fix).')).toContain(
        '<a class="md-link" href="https://x.io/fix">the fix</a>',
      );
    });

    it('escapes HTML before applying markdown', () => {
      const html = markdownToHtml('<img src=x onerror=alert(1)> **bold**');
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
      expect(html).toContain('<strong>bold</strong>');
    });

    it('renders headings, lists, quotes and fenced code as targetable blocks', () => {
      const html = markdownToHtml(
        '### Impact\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n```js\nconst a = 1;\n```',
      );
      expect(html).toContain('<h4 class="md-h">Impact</h4>');
      expect(html).toContain(
        '<ul class="md-list"><li>one</li><li>two</li></ul>',
      );
      expect(html).toContain(
        '<ol class="md-list"><li>first</li><li>second</li></ol>',
      );
      expect(html).toContain('<div class="md-quote">quoted</div>');
      expect(html).toContain('<pre class="code-block">const a = 1;</pre>');
    });

    it('turns [text](https://url) into a link instead of leaking the raw syntax', () => {
      const html = markdownToHtml(
        'See [the advisory](https://github.com/advisories/GHSA-1234) now.',
      );
      expect(html).toContain(
        '<a class="md-link" href="https://github.com/advisories/GHSA-1234">the advisory</a>',
      );
      expect(html).not.toContain('](');
    });

    it('keeps inline code inside a link text (no internal placeholder leaks)', () => {
      const html = markdownToHtml(
        'See [using `qs`](https://example.com/qs) now.',
      );
      expect(html).toContain(
        '<a class="md-link" href="https://example.com/qs">using <code class="code-inline">qs</code></a>',
      );
      expect(html).not.toMatch(/\u0000/);
    });

    it('never builds a link from a non-http(s) target', () => {
      const html = markdownToHtml('[x](javascript:alert(1))');
      expect(html).not.toContain('href="javascript');
    });

    it('lets long bare URLs break instead of overflowing the page', () => {
      const html = markdownToHtml(
        'PoC: https://github.com/example/a-very-long-repository-name/blob/main/src/file.ts#L22',
      );
      expect(html).toContain('<span class="md-url">https://github.com/');
    });

    it('keeps the * inside code spans literal (no italics inside code)', () => {
      const html = markdownToHtml(
        'Action set to `"*"` or Resource set to `" * "` and nested `*()` globs',
      );
      expect(html).toContain('<code class="code-inline">&quot;*&quot;</code>');
      expect(html).toContain('<code class="code-inline">*()</code>');
      expect(html).not.toContain('<em>');
    });

    it('renders a double-backtick code span that contains single backticks', () => {
      const html = markdownToHtml(
        'Use ``res.redirect(`${req.query.url}/path`)`` here',
      );
      // No space and long: an identifier, breakable before its separators.
      expect(html).toContain(
        '<code class="code-inline">res<wbr>.redirect(`${req<wbr>.query<wbr>.url}<wbr>/path`)</code>',
      );
    });

    it('only italicises a real *emphasis* delimited by word boundaries', () => {
      expect(markdownToHtml('a *real* emphasis')).toContain('<em>real</em>');
      expect(markdownToHtml('2 * 3 * 4')).not.toContain('<em>');
      expect(markdownToHtml('glob [^/]*? here')).toContain('[^/]*?');
    });

    it('masks secrets that a description carries in clear text', () => {
      const html = markdownToHtml(
        'Hardcoded key ( sk_live_EXAMPLEKEYEXAMPLEKEY0000 ) in `auth.py`',
      );
      expect(html).not.toContain('EXAMPLEKEYEXAMPLEKEY0000');
      // escapeHtml turns the bullets into numeric entities
      expect(html).toContain('sk_live_&#8226;&#8226;&#8226;&#8226;0000');
    });

    it('drops scanner test-fixture annotations from code blocks', () => {
      const html = markdownToHtml(
        '```\n# ruleid: ssrf-requests\nrequests.get(url)\n// ok: safe-case\n```',
      );
      expect(html).not.toContain('ruleid');
      expect(html).not.toContain('ok: safe-case');
      expect(html).toContain('requests.get(url)');
    });

    it('maps punctuation the embedded fonts lack to what they have', () => {
      const html = markdownToHtml('a\u2010b \u2011 c \u2192 d');
      expect(html).toContain('a-b - c -&gt; d');
    });

    it('closes an unbalanced backtick at the end of its line', () => {
      const html = markdownToHtml('Use `res.redirect(req.query.url) here');
      expect(html).toContain(
        '<code class="code-inline">res.redirect(req.query.url) here</code>',
      );
      expect(html).not.toContain('`');
    });

    it('treats a line with nested template-literal backticks as one code span from the first one', () => {
      // three backticks: the middle pair is a template literal inside the code
      const html = markdownToHtml(
        'Calls `res.redirect(`${req.query.url}/path`) directly',
      );
      expect(html).toContain(
        'Calls <code class="code-inline">res.redirect(`${req.query.url}/path`) directly</code>',
      );
    });

    it('also opens a paragraph on a label whose colon sits inside the bold', () => {
      const html = markdownToHtml('Intro.\n**Impact:** RCE.');
      expect(html).toContain(
        '<p class="md-p">Intro.</p><p class="md-p"><strong>Impact:</strong> RCE.</p>',
      );
    });

    it('drops references to the rule test fixtures', () => {
      const html = markdownToHtml(
        'Unsafe eval (see `test3`). It runs code (e.g., in test1). In the provided code example, input flows to eval. Fix it.',
      );
      expect(html).toContain('Unsafe eval. It runs code. Fix it.');
    });

    it('starts a new paragraph on a bold label line (**Root cause**: …)', () => {
      const html = markdownToHtml(
        'Intro line.\n**Root cause**: bad input.\n**Impact**: RCE.',
      );
      expect(html).toContain(
        '<p class="md-p">Intro line.</p><p class="md-p"><strong>Root cause</strong>: bad input.</p><p class="md-p"><strong>Impact</strong>: RCE.</p>',
      );
    });

    it('returns an empty string for empty input', () => {
      expect(markdownToHtml(undefined)).toBe('');
      expect(markdownToHtml('')).toBe('');
    });
  });

  describe('latinizeReportText', () => {
    it('turns arrows into the arrow token, and maths into ASCII', () => {
      expect(latinizeReportText('a → b ⟶ c ⇒ d')).toBe(
        'a \u0002 b \u0002 c \u0002 d',
      );
      expect(latinizeReportText('x ← y, v ≥ 1.1.4, n ≤ 2, a ≠ b, t ≈ 3')).toBe(
        'x <- y, v >= 1.1.4, n <= 2, a != b, t ~ 3',
      );
    });

    it('maps the hyphens the fonts lack, thin spaces, and drops invisible ones', () => {
      expect(latinizeReportText('a‐b‑c−d e f')).toBe('a-b-c-d e f');
      expect(latinizeReportText('co­op​era')).toBe('coopera');
    });

    it('drops check marks, emoji and non-latin scripts', () => {
      expect(latinizeReportText('✓ done ✔ ✗ ✘ 🚀 fixed 漢字 ok')).toBe(
        ' done     fixed  ok',
      );
    });

    it('keeps latin-1, tabs, newlines and the typographic punctuation the fonts carry', () => {
      const kept = 'Café à l’été\t– — ‘x’ “y” … • 5 € ™ ©\nend';
      expect(latinizeReportText(kept)).toBe(kept);
    });

    it('never lets a control character through (the arrow token included)', () => {
      expect(latinizeReportText('a\u0000b\u0002c\u0001d\re')).toBe('abcde');
    });
  });

  describe('analysisInlineHtml', () => {
    it('renders code spans, short ones unbreakable', () => {
      const html = analysisInlineHtml(
        'Call `eval(req.body.preTax)` then `memosDAO.insert(req.body.memo, callback)`.',
      );
      expect(html).toContain(
        '<code class="code-inline is-short">eval(req.body.preTax)</code>',
      );
      expect(html).toContain(
        '<code class="code-inline is-tight">memosDAO<wbr>.insert(req<wbr>.body<wbr>.memo, callback)</code>',
      );
      // 26 characters: still unbreakable; 27: breakable.
      expect(analysisInlineHtml(`\`${'a'.repeat(26)}\``)).toContain('is-short');
      expect(analysisInlineHtml(`\`${'a'.repeat(27)}\``)).not.toContain(
        'is-short',
      );
    });

    // A 72-character function name was clipped by the callout: with no break
    // point, it overflowed its column. A lone identifier (no space) now stays
    // in one piece while it fits on a line (.id-box), otherwise it is cut at
    // its separators and camelCase boundaries.
    it('cuts a long identifier at its separators and camelCase boundaries, whole in a box while it fits a line', () => {
      expect(
        analysisInlineHtml(
          'Validate the path in `resolveSettlementReconciliationExportFileForMerchantBatchWithRetryPolicy`.',
        ),
      ).toBe(
        'Validate the path in <span class="id-box"><code class="code-inline is-tight">resolve<wbr>Settlement<wbr>Reconciliation<wbr>Export<wbr>File<wbr>For<wbr>Merchant<wbr>Batch<wbr>With<wbr>Retry<wbr>Policy</code>.</span>',
      );
    });

    // The punctuation after the identifier and the opening mark before it go
    // into its box: neither the first starts a line alone, nor the second
    // stays alone at the end of one.
    it('keeps the punctuation around a long identifier inside its box', () => {
      expect(
        analysisInlineHtml(
          'Pin it (`@very-long-organization-name/extremely-long-package`), then retry.',
        ),
      ).toBe(
        'Pin it <span class="id-box">(<code class="code-inline is-tight">@very<wbr><nobr>-l</nobr>ong<wbr><nobr>-o</nobr>rganization<wbr><nobr>-n</nobr>ame<wbr>/extremely<wbr><nobr>-l</nobr>ong<wbr><nobr>-p</nobr>ackage</code>),</span> then retry.',
      );
    });

    // Code with spaces flows like a sentence: its spaces are its breaks, its
    // long words break at their separators.
    it('lets long code with spaces flow, each long word breakable', () => {
      expect(
        analysisInlineHtml(
          'Call `Files.newInputStream(Paths.get(exportRoot, merchantId, exportFileName))` now.',
        ),
      ).toBe(
        'Call <code class="code-inline">Files<wbr>.newInputStream(Paths<wbr>.get(exportRoot, merchantId, exportFileName))</code> now.',
      );
    });

    // A node of the attack path is already its own box.
    it('leaves a long identifier out of a box on demand', () => {
      expect(
        analysisInlineHtml(
          '`resolveSettlementReconciliationExportFileForMerchantBatchWithRetryPolicy`',
          { box: false },
        ),
      ).toBe(
        '<code class="code-inline">resolve<wbr>Settlement<wbr>Reconciliation<wbr>Export<wbr>File<wbr>For<wbr>Merchant<wbr>Batch<wbr>With<wbr>Retry<wbr>Policy</code>',
      );
    });

    it('keeps operators literal inside code', () => {
      expect(analysisInlineHtml('Test `typeof x !== "string"`.')).toContain(
        '<code class="code-inline is-short is-tight">typeof x !== &quot;string&quot;</code>',
      );
    });

    it('drops the agent bold and italics: the card has its own hierarchy', () => {
      const html = analysisInlineHtml(
        '**Steps**: use __strict__ mode, *always* and _now_, keep snake_case_name.',
      );
      expect(html).toBe(
        'Steps: use strict mode, always and now, keep snake_case_name.',
      );
    });

    it('reduces a link to its text and never builds an anchor', () => {
      const html = analysisInlineHtml(
        'See [the advisory](https://github.com/advisories/GHSA-v8w9-2789-6hhr).',
      );
      expect(html).not.toContain('<a');
      expect(html).not.toContain('href');
      expect(html).toContain('See the advisory.');
    });

    it('wraps a bare URL so it can break, without a link', () => {
      const html = analysisInlineHtml(
        'Read https://example.com/a?b=1&c=2 first.',
      );
      expect(html).toContain(
        '<span class="md-url">https://example.com/a?b=1&amp;c=2</span>',
      );
      expect(html).not.toContain('href');
    });

    it('keeps identifiers unbroken', () => {
      const html = analysisInlineHtml(
        'CVE-2021-23369 (GHSA-f2jv-r9rf-7988, CWE-94).',
      );
      expect(html).toContain('<span class="nw">CVE-2021-23369</span>');
      expect(html).toContain('<span class="nw">GHSA-f2jv-r9rf-7988</span>');
      expect(html).toContain('<span class="nw">CWE-94</span>');
    });

    it('draws an arrow outside code and writes -> inside it', () => {
      const html = analysisInlineHtml('`a → b` → sink');
      expect(html).toContain(
        '<code class="code-inline is-short">a -&gt; b</code>',
      );
      expect(html).toContain('<svg class="arrow ca-arrow"');
      expect(html).not.toContain('\u0002');
      expect(visibleText(html)).not.toContain('→');
    });

    it('writes maths in ASCII', () => {
      expect(analysisInlineHtml('when x ≥ y and a ≠ b')).toBe(
        'when x &gt;= y and a != b',
      );
      expect(analysisInlineHtml('Pin `bson ≥1.1.4`.')).toContain(
        '<code class="code-inline is-short is-tight">bson &gt;=1.1.4</code>.',
      );
    });

    // Outside code, an operator before a version looks like a draft in the
    // middle of a sentence, and « >= » splits from its version at a line end.
    it('says a version bound in words, outside code', () => {
      expect(
        analysisInlineHtml(
          'Upgrade so the tree resolves `bson` ≥ 1.1.4, or pin it.',
        ),
      ).toBe(
        'Upgrade so the tree resolves <code class="code-inline is-short">bson</code> 1.1.4 or later, or pin it.',
      );
      expect(analysisInlineHtml('handlebars >= 4.7.7 (fixed)')).toBe(
        'handlebars 4.7.7 or later (fixed)',
      );
      expect(analysisInlineHtml('lodash ≤ 4.17.20-rc.1.')).toBe(
        'lodash 4.17.20-rc.1 or earlier.',
      );
      expect(analysisInlineHtml('a CVSS ≥ 7.0 or Node >= 18')).toBe(
        'a CVSS 7.0 or higher or Node 18 or higher',
      );
      // Never a space after an opening bracket.
      expect(analysisInlineHtml('Upgrade requests (>= 2.31.0) now.')).toBe(
        'Upgrade requests (2.31.0 or later) now.',
      );
    });

    // A bare URL is copied as it is written: no curly apostrophe, no bound
    // in words inside it.
    it('never rewrites a bare URL', () => {
      const html = analysisInlineHtml(
        "See https://example.com/it's-here?v>=1.2.3, then [the doc](https://x.io/it's).",
      );
      expect(html).toContain(
        '<span class="md-url">https://example.com/it&#39;s-here?v&gt;=1.2.3</span>,',
      );
      expect(html).toContain('then the doc.');
      expect(html).not.toContain('x.io');
    });

    it('uses the curly apostrophe of the report, never inside code', () => {
      expect(
        analysisInlineHtml("The victim's browser and `a'b` in 'quotes'"),
      ).toBe(
        'The victim&#8217;s browser and <code class="code-inline is-short">a&#39;b</code> in &#39;quotes&#39;',
      );
    });

    // A chip's background is painted after the text before it: pulled
    // against an opening parenthesis, it would hide its ink.
    it('sets code tight against the punctuation after it, never before', () => {
      expect(
        analysisInlineHtml(
          'Rename it (`name: "sessionId"`), then `x`; add (`y`).',
        ),
      ).toBe(
        'Rename it (<code class="code-inline is-short is-tight">name: &quot;sessionId&quot;</code>), then <code class="code-inline is-short is-tight">x</code>; add (<code class="code-inline is-short is-tight">y</code>).',
      );
      expect(analysisInlineHtml('Run `a` now')).toBe(
        'Run <code class="code-inline is-short">a</code> now',
      );
    });

    it('keeps markup from the analysis inert', () => {
      for (const md of [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '[x](javascript:alert(1))',
        '[y](data:text/html;base64,PHNjcmlwdD4=)',
        '`<script>alert(1)</script>`',
      ]) {
        const html = analysisInlineHtml(md);
        expect(html).not.toMatch(/<(?:script|img|a)\b/);
        expect(html).not.toContain('href');
      }
      expect(analysisInlineHtml('<script>alert(1)</script>')).toContain(
        '&lt;script&gt;',
      );
      expect(analysisInlineHtml('[x](javascript:alert(1))')).toBe('x');
    });

    it('opens code to the end on an odd backtick, like the description renderer', () => {
      const html = analysisInlineHtml('Use `res.redirect(req.query.url) here');
      expect(html).toBe(
        'Use <code class="code-inline">res<wbr>.redirect(req<wbr>.query<wbr>.url) here</code>',
      );
    });

    it('masks secrets quoted by the analysis', () => {
      const html = analysisInlineHtml(
        'The default `cookieSecret: "session_cookie_secret_key_here"` is hardcoded.',
      );
      expect(html).not.toContain('session_cookie_secret_key_here');
      expect(visibleText(html)).toContain('cookieSecret: "••••"');
    });

    it('never shows raw markdown nor a glyph outside the embedded fonts', () => {
      const html = analysisInlineHtml(
        '## Fix: **upgrade** `bson` ≥ 1.1.4 → [notes](https://x.io) ✓ 🚀 **dangling',
      );
      const text = visibleText(html);
      expect(text).not.toMatch(/\*\*|`|## |\]\(/);
      expect(text).not.toMatch(OUTSIDE_WHITELIST_RE);
    });

    it('drops a heading marker flattened into a sentence, never one inside code', () => {
      expect(
        analysisInlineHtml('Intro. ## Impact RCE, issue #12, C# code'),
      ).toBe('Intro. Impact RCE, issue #12, C# code');
      expect(analysisInlineHtml('`a ## b`')).toBe(
        '<code class="code-inline is-short">a ## b</code>',
      );
    });

    it('returns an empty string for empty input', () => {
      expect(analysisInlineHtml('')).toBe('');
    });
  });

  describe('clampMarkdown', () => {
    it('leaves short text untouched', () => {
      expect(clampMarkdown('Short text.', 200)).toEqual({
        text: 'Short text.',
        truncated: false,
      });
    });

    it('keeps whole paragraphs while they fit, then stops', () => {
      const md = `${'a'.repeat(100)}\n\n${'b'.repeat(100)}\n\n${'c'.repeat(100)}`;
      const out = clampMarkdown(md, 250);
      expect(out.truncated).toBe(true);
      expect(out.text).toBe(`${'a'.repeat(100)}\n\n${'b'.repeat(100)}`);
    });

    it('cuts an oversized first paragraph on a word boundary with an ellipsis', () => {
      const md = 'word '.repeat(100).trim();
      const out = clampMarkdown(md, 52);
      expect(out.truncated).toBe(true);
      expect(out.text.endsWith('…')).toBe(true);
      expect(out.text.length).toBeLessThanOrEqual(53);
      expect(out.text).not.toMatch(/wor…$/);
    });

    it('ends an oversized paragraph on its last full sentence when there is one', () => {
      const md = `${'First sentence is here. '.repeat(3)}Then a very long tail that goes on and on without end`;
      const out = clampMarkdown(md, 90);
      expect(out.text).toBe(
        'First sentence is here. First sentence is here. First sentence is here.',
      );
      expect(out.truncated).toBe(true);
    });

    it('drops a trailing lead-in that announces what was cut', () => {
      const md = `${'a'.repeat(60)}\n\nThis leads to:\n\n${'b'.repeat(200)}`;
      const out = clampMarkdown(md, 120);
      expect(out.text).toBe('a'.repeat(60));
    });

    it('never cuts inside a fenced code block', () => {
      const md = `Intro paragraph.\n\n\`\`\`\n${'x\n'.repeat(200)}\`\`\`\n\nAfter.`;
      const out = clampMarkdown(md, 100);
      expect(out.text).toBe('Intro paragraph.');
      expect(out.truncated).toBe(true);
    });
  });
});

describe('text that spells the internal placeholders', () => {
  // Code spans and links are set aside as NUL-delimited slot numbers. A
  // scanner description or an LLM answer carrying NUL characters must not be
  // able to spell one: a slot holding its own placeholder never restored
  // (the render looped for ever), and one pasted in a link URL broke out of
  // its attribute.
  const NUL = '\u0000';

  it.each([
    ['a code span holding a slot', `\`${NUL}0${NUL}\``],
    ['two spans holding each other', `\`${NUL}1${NUL}\` and \`${NUL}0${NUL}\``],
    ['a slot inside a link URL', `[t](https://x${NUL}0${NUL}) \`a"b\``],
  ])('markdownToHtml renders %s once, without NUL', (_name, md) => {
    const html = markdownToHtml(md);
    expect(html).not.toContain(NUL);
    expect(html).not.toMatch(/href="[^"]*"[^>\s]/);
  });

  it.each([
    ['a code span holding a slot', `\`${NUL}0${NUL}\``],
    ['a long code span holding a slot', `\`${'x'.repeat(40)}${NUL}0${NUL}\``],
  ])('analysisInlineHtml renders %s once, without NUL', (_name, md) => {
    expect(analysisInlineHtml(md)).not.toContain(NUL);
  });
});
