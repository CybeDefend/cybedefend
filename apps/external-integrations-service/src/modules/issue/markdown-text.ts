/**
 * Helpers that write a value from scanned content (a finding's name,
 * description, file path, package, branch) into a GitHub or GitLab ticket
 * as text. Both render the ticket as Markdown, so the value must not add a
 * link, an image, HTML, a heading, a table cell, a code span of its own, a
 * mention that notifies people, a reference to another issue, merge
 * request, snippet or milestone, or a GitLab quick action (GitLab runs a
 * line that starts with `/` in an issue or a comment created through its
 * API). GitHub has no such commands in text: its slash commands are an
 * editor feature only.
 */

// Every C0 and C1 control character, line breaks and tabs included.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]+/g;
// Bidirectional controls: they can show a file or branch name reordered.
const BIDI_CONTROLS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]+/g;
// The same, line feeds kept (for a description shown on several lines).
const CONTROL_CHARACTERS_BUT_LINE_FEED =
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]+/g;
// What could turn text into a link, an image, HTML, emphasis, code, a table,
// a heading or an entity.
const MARKDOWN_MARKUP = /[\\`*_[\]<>|~#!&]/g;
// `@name` notifies a user or a team; `#12`, `!12`, `&12`, `$12` and `%12`
// link (and, after a closing keyword, close) another issue, merge request,
// epic, snippet or milestone; `GH-12` links an issue on GitHub.
const MENTION_OR_REFERENCE =
  /(@)(?=[A-Za-z0-9_-])|([#!&$%])(?=\d)|(\bGH-)(?=\d)/gi;
// A line made only of `=` or `-` turns the line above into a heading.
const SETEXT_UNDERLINE = /^[=-][=\-\s]*$/;
// Invisible: the text reads the same, the platform no longer sees a mention
// or a reference.
const ZERO_WIDTH_JOINER = '\u200D';
// One field of a finding never fills the ticket on its own.
const MAX_INLINE_LENGTH = 1000;

function clip(value: string, max: number): string {
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  return `${chars.slice(0, max - 1).join('')}…`;
}

function oneLine(value: unknown): string {
  return String(value ?? '')
    .replace(BIDI_CONTROLS, '')
    .replace(CONTROL_CHARACTERS, ' ')
    .trim();
}

function breakMentionsAndReferences(value: string): string {
  return value.replace(MENTION_OR_REFERENCE, `$&${ZERO_WIDTH_JOINER}`);
}

function escapeMarkup(value: string): string {
  return value.replace(MARKDOWN_MARKUP, '\\$&');
}

/** A value inside a sentence, a list item or a table cell. */
export function markdownText(value: unknown): string {
  return escapeMarkup(
    breakMentionsAndReferences(clip(oneLine(value), MAX_INLINE_LENGTH)),
  );
}

/** A value shown on its own lines (a finding's description). */
export function markdownParagraph(value: unknown): string {
  return String(value ?? '')
    .replace(BIDI_CONTROLS, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARACTERS_BUT_LINE_FEED, ' ')
    .split('\n')
    .map((line) => paragraphLine(line.trim()))
    .join('\n')
    .trim();
}

function paragraphLine(line: string): string {
  const escaped = escapeMarkup(breakMentionsAndReferences(line));
  // A leading `/` is a GitLab quick action; a lone `===` or `---` line is a
  // heading underline. A backslash in front keeps both as text.
  if (escaped.startsWith('/') || SETEXT_UNDERLINE.test(escaped)) {
    return `\\${escaped}`;
  }
  return escaped;
}

/**
 * A value in a code span. A back-tick would close the span early, so it
 * becomes an apostrophe. In a table a `|` ends the cell even inside a code
 * span, so it is escaped there. Mentions and references are not read in a
 * code span, so the value stays exact: a copied branch or path still works.
 */
export function markdownCode(
  value: unknown,
  options: { inTable?: boolean } = {},
): string {
  let inline = clip(oneLine(value).replace(/`/g, "'"), MAX_INLINE_LENGTH);
  if (options.inTable) {
    inline = inline.replace(/\|/g, '\\|');
  }
  return `\`${inline}\``;
}

/**
 * A ticket title. Titles are shown as plain text, where a backslash would
 * show: the value is put on one line and its mentions and references are
 * broken.
 */
export function plainTitleText(value: unknown): string {
  return breakMentionsAndReferences(oneLine(value));
}

/**
 * The address of a link the builder writes: characters that would end the
 * link or open another one are percent-encoded.
 */
export function markdownLinkDestination(url: unknown): string {
  return String(url ?? '').replace(/[()[\]<>`\s]/g, (char) =>
    /\s/.test(char)
      ? encodeURIComponent(char)
      : `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
