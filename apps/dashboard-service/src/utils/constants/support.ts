/**
 * Attributes every external link must carry: `noopener` denies the opened page
 * access to `window.opener`, `noreferrer` withholds the originating URL.
 */
export const EXTERNAL_LINK_PROPS = {
  target: '_blank',
  rel: 'noopener noreferrer',
} as const;
