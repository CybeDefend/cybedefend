/**
 * The invitation e-mail is sent to an address the inviter chooses, under the
 * instance's own sender, and the organisation name in it is chosen freely by
 * whoever created the organisation. That name is therefore shown as inert
 * text only:
 *
 * - control and invisible formatting characters (line breaks, bidirectional
 *   overrides, zero-width characters) become spaces, then spaces collapse;
 * - it is cut at INVITATION_ORGANIZATION_NAME_MAX characters;
 * - every `.`, `@`, `/` and `:`, and their Unicode look-alikes, is followed
 *   by a zero-width space, so that
 *   no mail client turns a part of it into a link (`example.com`,
 *   `https://…`, `someone@example.com`);
 * - it is quoted, so it never reads as a sentence of the message itself.
 *
 * The subject line carries no part of it.
 */
export const INVITATION_ORGANIZATION_NAME_MAX = 60;

/** The subject of every invitation e-mail: fixed text only. */
export const INVITATION_SUBJECT =
  'You are invited to join an organization on CybeDefend';

const ZERO_WIDTH_SPACE = '​';

export function inertOrganizationName(name: string | null | undefined): string {
  const visible = (name ?? '')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const chars = [...visible];
  const cut =
    chars.length > INVITATION_ORGANIZATION_NAME_MAX
      ? `${chars.slice(0, INVITATION_ORGANIZATION_NAME_MAX - 1).join('')}…`
      : visible;
  if (cut === '') return 'an organization';
  return `“${cut.replace(LINK_PUNCTUATION, (c) => `${c}${ZERO_WIDTH_SPACE}`)}”`;
}

/**
 * The characters a mail client or a browser may read as the dot of a host
 * name, the at-sign of an address, or the slash and colon of a URL: the
 * ASCII ones and their Unicode look-alikes (ideographic, fullwidth,
 * halfwidth and small forms, the one dot leader, the fraction and division
 * slashes).
 */
const LINK_PUNCTUATION = /[.。．｡․﹒@＠﹫/／⁄∕:：﹕]/gu;
