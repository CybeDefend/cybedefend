// Every C0 and C1 control character, line breaks and tabs included.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]+/g;
// Bidirectional controls: they can show a branch or package name reordered.
const BIDI_CONTROLS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]+/g;

/**
 * A value from a user or from scanned content, written into Slack mrkdwn as
 * plain text. Slack reads `<…>` as a mention (`<!here>`, `<!channel>`,
 * `<@U…>`) or as a link whose label hides its address (`<url|label>`), and
 * `&` starts an entity; Slack's own rule is to escape these three characters
 * in any text it should not interpret.
 */
export function slackText(value: unknown): string {
  return String(value ?? '')
    .replace(BIDI_CONTROLS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * A value shown in a code span. A back-tick inside it would close the span
 * and let the rest be read as markup, so it becomes an apostrophe; line
 * breaks would end the span too and become spaces.
 */
export function slackCode(value: unknown): string {
  const inline = String(value ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/`/g, "'");
  return `\`${slackText(inline)}\``;
}
