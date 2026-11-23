// report-markdown.ts
//
// Minimal, safe Markdown rendering for the free texts of the reports
// (advisory descriptions, the agent's reasoning). The HTML is escaped
// BEFORE the Markdown is applied: no tenant-controlled data reaches the
// Puppeteer browser unescaped.

import { escapeHtml } from '../../../core/utils/html-escape';
import { redactQuotedSecrets, redactSecrets } from './report-findings';
import { arrowIcon } from './report-layout';
import { breakableId, isLongId } from './report-styles';

const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL_RE = /(^|[\s(])(https?:\/\/[^\s<)]+)/g;

// ---------------------------------------------------------------------------
// Long identifiers in inline code (the break rules of breakableId)

/**
 * A long identifier of a code span (no space, over LONG_ID_CHARS
 * characters): breakable at its separators and camelCase boundaries
 * (breakableId), in a box (.id-box) that keeps it whole while it fits a
 * line. `cls`: the classes of the `<code>`.
 */
const boxedCode = (raw: string, cls: string): string =>
  `<span class="id-box"><code class="${cls}">${breakableId(raw)}</code></span>`;

// An opening mark right before a box, a closing one right after it (the
// entities of escapeHtml included: quotes, apostrophes, « »).
const OPENERS = String.raw`(?:[(\[{]|&quot;|&#39;|&#8216;|&#8220;|&#171;)+`;
const CLOSERS = String.raw`(?:[,.;:!?)\]}]|&quot;|&#39;|&#8217;|&#8221;|&#187;)+`;
const BOX_OPENER_RE = new RegExp(`(${OPENERS})<span class="id-box">`, 'g');
const BOX_CLOSER_RE = new RegExp(
  `(<span class="id-box">(?:(?!</span>)[\\s\\S])*)</span>(${CLOSERS})`,
  'g',
);

/**
 * The punctuation around a boxed identifier goes into its box: Chromium
 * breaks between an inline block and what touches it, so a closing mark
 * would start a line alone and an opening one would end a line alone.
 */
const glueBoxPunctuation = (html: string): string =>
  html
    .replace(BOX_OPENER_RE, '<span class="id-box">$1')
    .replace(BOX_CLOSER_RE, '$1$2</span>');

// The entities of escapeHtml back to their character (a code span of a
// description arrives escaped): escapeHtml(unescapeHtml(x)) === x.
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
};
const unescapeHtml = (html: string): string =>
  html.replace(/&(amp|lt|gt|quot|#\d+);/g, (_m, name: string) =>
    name.startsWith('#')
      ? String.fromCharCode(Number(name.slice(1)))
      : NAMED_ENTITIES[name],
  );

// Code spans of a line, set aside (placeholders from `hold`) before any other
// inline rule. An odd number of backticks means a template literal nested in
// code: the code runs from the first backtick to the end of the line (`tail`,
// appended by the caller after its own rules). ``a `b` c`` wraps single
// backticks (CommonMark), then plain `code`. `render` gets the raw span body.
function splitCodeSpans(
  line: string,
  render: (body: string) => string,
  hold: (html: string) => string,
): { head: string; tail: string } {
  let head = line;
  let tail = '';
  if ((line.match(/`/g)?.length ?? 0) % 2 === 1) {
    const i = line.indexOf('`');
    head = line.slice(0, i);
    tail = render(line.slice(i + 1));
  }
  const code = (_m: string, body: string) => hold(render(body));
  return {
    head: head.replace(/``\s?(.+?)\s?``/g, code).replace(/`([^`]+)`/g, code),
    tail,
  };
}

// Placeholders are NUL-delimited slot numbers: text must never spell one, or
// a slot could hold its own placeholder (restored for ever) or paste markup
// into an attribute. NUL prints nothing in a report.
const stripNul = (text: string): string => text.replace(/\u0000/g, '');

// Restores the placeholders of `hold`: a held link can itself hold code
// (`[using `x`](url)`), so restore until none is left, never letting one leak
// into the output. Nesting is at most one level per slot, so more passes than
// slots means a cycle: what is left is dropped.
function restoreSlots(html: string, slots: readonly string[]): string {
  let out = html;
  for (let pass = 0; pass <= slots.length; pass++) {
    if (!/\u0000\d+\u0000/.test(out)) return out;
    out = out.replace(
      /\u0000(\d+)\u0000/g,
      (_m, i: string) => slots[Number(i)] ?? '',
    );
  }
  return stripNul(out.replace(/\u0000\d+\u0000/g, ''));
}

// Inline formatting applied to already-escaped text. Code spans and links are
// set aside first (placeholders), so a `*` inside code is never read as an
// emphasis delimiter. Links are rebuilt from the escaped text: the URL can
// only contain what the regex allows (http(s), `"` escaped to &quot;).
const inline = (input: string): string => {
  const line = stripNul(input);
  const slots: string[] = [];
  const hold = (html: string) => {
    slots.push(html);
    return `\u0000${slots.length - 1}\u0000`;
  };
  // A long identifier (no space) breaks at its separators, whole while it
  // fits a line; a short code, or one with spaces, keeps its markup.
  const { head, tail } = splitCodeSpans(
    line,
    (body) => {
      const raw = unescapeHtml(body);
      return isLongId(raw) && !/\s/.test(raw)
        ? boxedCode(raw, 'code-inline')
        : `<code class="code-inline">${body}</code>`;
    },
    hold,
  );
  const html = head
    .replace(LINK_RE, (_m, text: string, url: string) =>
      hold(`<a class="md-link" href="${url}">${text}</a>`),
    )
    .replace(BARE_URL_RE, '$1<span class="md-url">$2</span>')
    .replace(/\*\*(?=\S)([^*]+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
    .replace(
      /(^|[^\w*])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\w*])/g,
      '$1<em>$2</em>',
    );
  return glueBoxPunctuation(restoreSlots(html, slots) + tail);
};

// Block-level rendering of an already-escaped (non-code) segment: headings,
// real bullet/numbered lists, blockquotes and paragraphs.
const renderProse = (escaped: string): string => {
  const out: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (listType) {
      out.push(
        `<${listType} class="md-list">${listItems.map((i) => `<li>${i}</li>`).join('')}</${listType}>`,
      );
      listType = null;
      listItems = [];
    }
  };
  const flushPara = () => {
    if (para.length) {
      out.push(`<p class="md-p">${para.join('<br>')}</p>`);
      para = [];
    }
  };
  for (const line of escaped.split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    const quote = line.match(/^&gt;\s?(.+)$/);
    if (heading) {
      flushPara();
      flushList();
      out.push(`<h4 class="md-h">${inline(heading[1])}</h4>`);
    } else if (bullet) {
      flushPara();
      if (listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(inline(bullet[1]));
    } else if (ordered) {
      flushPara();
      if (listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(inline(ordered[1]));
    } else if (quote) {
      flushPara();
      flushList();
      out.push(`<div class="md-quote">${inline(quote[1])}</div>`);
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      // « **Root cause**: … » opens its own paragraph.
      if (/^\*\*[^*]+(?::\*\*|\*\*\s*:)/.test(line)) flushPara();
      para.push(inline(line));
    }
  }
  flushPara();
  flushList();
  return out.join('');
};

// Scanner test-fixture annotations (Semgrep `ruleid:` / `ok:` markers) that
// leak from rule examples into catalogue descriptions.
const FIXTURE_LINE_RE =
  /^\s*(?:#|\/\/)\s*(?:ruleid|todoruleid|ok|todook):.*(?:\n|$)/gm;

/**
 * Characters of a last word bound to the one before it, and of that pair:
 * a longer word, or pair, may start a line of its own. A long last word of
 * the scanners' texts (« parameterization. », 17) binds while the pair stays
 * short.
 */
const WIDOW_WORD_MAX = 20;
const WIDOW_PAIR_MAX = 30;

/** Characters a reader sees in a piece of HTML text (an entity is one). */
const shownLength = (text: string): number =>
  text.replace(/&[#\w]+;/g, 'x').length;

/**
 * A paragraph never ends on a short word alone ("vaults.", "targetDir."):
 * the space before its last word, outside any code span, becomes a
 * non-breaking one (text-wrap: pretty does not guarantee it in Chromium).
 */
export function bindLastWords(body: string): string {
  const parts = body.split(/(<[^>]*>)/);
  // Inside a code span when read backwards: after its closing tag.
  let inCode = false;
  let last = 0;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (part.startsWith('<')) {
      if (/^<\/code>/.test(part)) inCode = true;
      else if (/^<code\b/.test(part)) inCode = false;
      else if (/^<\/?(?:br|ul|ol|li|p|pre)\b/.test(part)) return body;
      continue;
    }
    const space = part.lastIndexOf(' ');
    if (space < 0) {
      last += shownLength(part);
      continue;
    }
    if (inCode) return body;
    last += shownLength(part.slice(space + 1));
    if (!last || last > WIDOW_WORD_MAX) return body;
    if (last + 1 + wordBefore(parts, i, space) > WIDOW_PAIR_MAX) return body;
    parts[i] = `${part.slice(0, space)}\u00a0${part.slice(space + 1)}`;
    return parts.join('');
  }
  return body;
}

/**
 * Characters of the word before a space (`parts[i]` at `space`), code spans
 * and inline tags included: back to the previous space.
 */
function wordBefore(parts: string[], i: number, space: number): number {
  let n = 0;
  for (let j = i; j >= 0; j -= 1) {
    if (parts[j].startsWith('<')) continue;
    const text = j === i ? parts[j].slice(0, space) : parts[j];
    const cut = text.lastIndexOf(' ');
    n += shownLength(text.slice(cut + 1));
    if (cut >= 0) break;
  }
  return n;
}

// A Markdown link, reduced to its text in an untrusted text.
const MD_LINK_RE = /\[([^\]\n]+)\]\((?:[^()\s]|\([^()\s]*\))*\)/g;

export interface MarkdownOptions {
  /**
   * Written by an LLM (the short note of the agent): the secrets it quotes
   * are masked as in a Cybe Analysis brief, and a link it writes is printed
   * as its text, never as a link.
   */
  untrusted?: boolean;
}

export function markdownToHtml(
  raw: string | undefined | null,
  opts: MarkdownOptions = {},
): string {
  if (!raw) return '';
  const source = opts.untrusted
    ? redactQuotedSecrets(raw).replace(MD_LINK_RE, '$1')
    : raw;
  // Punctuation outside the embedded latin subset would fall back to a Type 3
  // font: non-breaking/soft hyphens become '-', the arrow '->'.
  const s = redactSecrets(source)
    .replace(/[\u2010\u2011]/g, '-')
    .replace(/\u2192/g, '->')
    // References to the rule's own test fixtures mean nothing to a reader.
    .replace(/\s*\((?:see|e\.g\.,?\s*in)\s+`?test\d+`?\)/gi, '')
    .replace(/In the provided code example[^.]*\.\s*/g, '');
  // A fence opens a line and its info string ends the line: an inline
  // ``code`` span on one line is never taken for a code block.
  const fenceRe = /(?<=^|\n)(`{2,3})[^\n`]*\n([\s\S]*?)\n?\1(?=\n|$)/g;
  const out: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(s)) !== null) {
    if (m.index > last)
      out.push(renderProse(escapeHtml(s.slice(last, m.index))));
    const code = m[2].replace(FIXTURE_LINE_RE, '').trimEnd();
    out.push(`<pre class="code-block">${escapeHtml(code)}</pre>`);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(renderProse(escapeHtml(s.slice(last))));
  return out.join('');
}

/**
 * Apostrophe between two letters of rendered Markdown: the curly one (’) of
 * every report's text. Text only, never a tag or its attributes, a `<code>`,
 * a `<pre>` or a bare URL. To apply after the secrets are masked
 * (markdownToHtml does).
 */
export const curlyApostrophesHtml = (html: string): string =>
  html.replace(
    /<(code|pre)\b[^>]*>[\s\S]*?<\/\1>|<span class="md-url">[^<]*<\/span>|<[^>]*>|[^<]+/g,
    (chunk) =>
      chunk.startsWith('<')
        ? chunk
        : chunk.replace(/(?<=[A-Za-z])&#39;(?=[A-Za-z])/g, '&#8217;'),
  );

/**
 * Truncates Markdown to ~`maxChars`, keeping whole paragraphs; a first
 * paragraph that is too long is cut on a word boundary with « … ». A code
 * block is never cut: it is kept whole or dropped.
 */
export function clampMarkdown(
  s: string | undefined | null,
  maxChars: number,
): { text: string; truncated: boolean } {
  const text = (s ?? '').trim();
  if (text.length <= maxChars) return { text, truncated: false };
  // Blocks separated by blank lines, keeping fenced code blocks whole.
  const blocks: string[] = [];
  const fenceRe = /```[\s\S]*?```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushProse = (chunk: string) =>
    chunk
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean)
      .forEach((b) => blocks.push(b));
  while ((m = fenceRe.exec(text)) !== null) {
    pushProse(text.slice(last, m.index));
    blocks.push(m[0]);
    last = m.index + m[0].length;
  }
  pushProse(text.slice(last));

  const kept: string[] = [];
  let length = 0;
  for (const block of blocks) {
    const added = (kept.length ? 2 : 0) + block.length;
    if (length + added > maxChars) break;
    kept.push(block);
    length += added;
  }
  // A kept block that only announces what follows (« …leads to: ») is dropped.
  while (kept.length > 1 && /:\s*$/.test(kept[kept.length - 1])) kept.pop();
  if (kept.length > 0) return { text: kept.join('\n\n'), truncated: true };
  const first = blocks[0] ?? '';
  if (first.startsWith('```')) return { text: '', truncated: true };
  const cut = first.slice(0, maxChars);
  // Prefer the last full sentence, if it keeps a fair share of the budget.
  const sentenceEnd = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
  );
  if (sentenceEnd >= maxChars * 0.4) {
    return { text: cut.slice(0, sentenceEnd + 1), truncated: true };
  }
  const boundary = cut.lastIndexOf(' ');
  return {
    text: `${(boundary > 0 ? cut.slice(0, boundary) : cut).replace(/[\s,;:.]+$/, '')}…`,
    truncated: true,
  };
}

// ---------------------------------------------------------------------------
// Text of a Cybe Analysis (the reports' callout)

/**
 * Arrow token: `→`, `⟶` and `⇒` become it (latinizeReportText), and the
 * rendering replaces it with the SVG arrow (outside code) or `->` (inside
 * code). A control character, which latinizeReportText removes from any
 * input: no text can forge it.
 */
export const ARROW_TOKEN = '\u0002';

// Glyphs missing from the latin subset of the embedded fonts, and their
// replacement ('': removed).
const LATIN_REPLACEMENTS: Readonly<Record<string, string>> = {
  '→': ARROW_TOKEN,
  '⟶': ARROW_TOKEN,
  '⇒': ARROW_TOKEN,
  '←': '<-',
  '≥': '>=',
  '≤': '<=',
  '≠': '!=',
  '≈': '~',
  '‐': '-',
  '‑': '-',
  '−': '-',
  ' ': ' ',
  '­': '',
  '​': '',
};
// Typographic punctuation outside latin-1 that the fonts carry.
const LATIN_EXTRA = new Set([...'–—‘’“”…•€™']);

/**
 * Brings an analysis text down to the glyphs of the embedded fonts (Rubik
 * and JetBrains Mono, latin subset): a missing glyph would fall back to
 * FreeSans, embedded as Type 3. Keeps tab, newline, U+0020 to U+00FF and
 * `– — ‘ ’ “ ” … • € ™`; arrows become ARROW_TOKEN, mathematical signs their
 * ASCII form; any other character (emoji, check marks, symbols, non-latin
 * scripts, controls) is removed.
 */
export function latinizeReportText(text: string): string {
  let out = '';
  for (const ch of text ?? '') {
    const replacement = LATIN_REPLACEMENTS[ch];
    if (replacement !== undefined) {
      out += replacement;
      continue;
    }
    const cp = ch.codePointAt(0) ?? 0;
    if (
      cp === 0x09 ||
      cp === 0x0a ||
      (cp >= 0x20 && cp <= 0xff) ||
      LATIN_EXTRA.has(ch)
    )
      out += ch;
  }
  return out;
}

const ARROW_HTML = arrowIcon().replace(
  'class="arrow"',
  'class="arrow ca-arrow"',
);
// A short code (a call, a file name) stays in one piece.
const SHORT_CODE_MAX = 26;
const ANY_BARE_URL_RE = /(^|[\s(])(https?:\/\/[^\s<)]+)/g;
// Punctuation (or a quote) that closes the sentence, not the URL.
const URL_TAIL_RE = /[.,;:!?"']+$/;
const ID_RE = /\b(CWE-\d+|CVE-\d{4}-\d{4,}|GHSA(?:-[0-9a-z]{4}){3})\b/g;
// Version bound outside code (« ≥ 1.1.4 », already « >= 1.1.4 » after
// latinizeReportText): said in words, it no longer splits from its version.
const BOUND_RE = /\s*(>=|<=)\s*(v?\d+(?:\.\d+)*(?:-[\w.]*\w)?)(?!\w|\.\d)/g;
// Apostrophe between two letters: the curly one of the report's text.
const APOSTROPHE_RE = /(?<=[A-Za-z])'(?=[A-Za-z])/g;

/**
 * « >= 1.1.4 »: « 1.1.4 or later »; « >= 7.0 »: « 7.0 or higher ». A space
 * separates it from the word before, never from the start of a text or an
 * opening parenthesis (« (2.31.0 or later) »).
 */
function boundInWords(
  _m: string,
  op: string,
  value: string,
  offset: number,
  whole: string,
): string {
  const version = (value.match(/\./g)?.length ?? 0) >= 2;
  const words =
    op === '>='
      ? version
        ? 'or later'
        : 'or higher'
      : version
        ? 'or earlier'
        : 'or lower';
  const open = offset === 0 || /[([{]/.test(whole[offset - 1]);
  return `${open ? '' : ' '}${value} ${words}`;
}

// Code tight against the punctuation that follows it, as in the report
// body: « `x`, » without the gap of the chip's background. Never against the
// punctuation before it: the background, painted after it, would hide its ink.
const tightCode = (html: string): string =>
  html.replace(
    /<code class="([^"]*)">((?:(?!<\/code>)[\s\S])*)<\/code>(?=[,.;:!?)])/g,
    '<code class="$1 is-tight">$2</code>',
  );

/**
 * Inline Markdown of a Cybe Analysis (sentence, fact, step) to safe HTML.
 * Order: secrets masked, latin glyphs, code spans set aside, link reduced to
 * its text (its URL comes from an LLM), bare URL set aside as written
 * (breakable), version bounds said in words and curly apostrophes (outside
 * code and URLs), escaping, then minimal Markdown: the agent's bold and
 * italics are removed (the callout has its own hierarchy), identifiers (CWE,
 * CVE, GHSA) non-breaking, code tight against its punctuation. No HTML of the
 * analysis reaches the browser.
 *
 * A long code breaks by the rules of breakableId, word by word; without a
 * space it is an identifier, kept in one piece while it fits on a line in its
 * box (.id-box), with the punctuation around it. `box: false`: no box (a node
 * of the attack path is already its own).
 */
export function analysisInlineHtml(
  md: string,
  opts: { box?: boolean } = {},
): string {
  if (!md) return '';
  const box = opts.box ?? true;
  const s = latinizeReportText(redactQuotedSecrets(stripNul(md)));
  const slots: string[] = [];
  const hold = (html: string) => {
    slots.push(html);
    return `\u0000${slots.length - 1}\u0000`;
  };
  const { head, tail } = splitCodeSpans(
    s,
    (body) => {
      const text = body.split(ARROW_TOKEN).join('->');
      if (text.length <= SHORT_CODE_MAX)
        return `<code class="code-inline is-short">${escapeHtml(text)}</code>`;
      if (box && !/\s/.test(text)) return boxedCode(text, 'code-inline');
      return `<code class="code-inline">${text
        .split(/(\s+)/)
        .map((word) => (/\s/.test(word) ? escapeHtml(word) : breakableId(word)))
        .join('')}</code>`;
    },
    hold,
  );
  // A link is reduced to its text (its URL comes from an LLM); a bare URL is
  // set aside as written, before the bounds and the apostrophes.
  const prose = head
    .replace(MD_LINK_RE, '$1')
    .replace(ANY_BARE_URL_RE, (_m, lead: string, url: string) => {
      const end = URL_TAIL_RE.exec(url)?.[0] ?? '';
      const bare = url.slice(0, url.length - end.length);
      return `${lead}${hold(`<span class="md-url">${escapeHtml(bare.split(ARROW_TOKEN).join('->'))}</span>`)}${end}`;
    })
    .replace(BOUND_RE, boundInWords)
    .replace(APOSTROPHE_RE, '\u2019');
  const html = escapeHtml(prose)
    // A heading flattened into a sentence (« … ## Impact … ») loses its mark.
    .replace(/(^|\s)#{1,6}[ \t]+/g, '$1')
    .replace(/\*\*(?=\S)([^*]+?)(?<=\S)\*\*/g, '$1')
    .replace(/(^|[^\w])__(?=\S)(.+?)(?<=\S)__(?!\w)/g, '$1$2')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?!\w)/g, '$1$2')
    .replace(/\*\*/g, '')
    .replace(ID_RE, '<span class="nw">$1</span>');
  return tightCode(glueBoxPunctuation(restoreSlots(html, slots) + tail))
    .split(ARROW_TOKEN)
    .join(ARROW_HTML);
}

// ---------------------------------------------------------------------------
// Visible text

/**
 * Visible text of an inline Markdown: no backticks, no bold or italics, links
 * reduced to their text, whitespace collapsed. Basis of every length
 * measurement.
 */
export function plainText(md: string): string {
  return String(md ?? '')
    .replace(MD_LINK_RE, '$1')
    .replace(/`/g, '')
    .replace(/\*\*|__/g, '')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?!\w)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}
