export const EDITIONS = ['community', 'cloud', 'enterprise'] as const;
export type Edition = (typeof EDITIONS)[number];
// Community Edition: the edition is fixed; CYBEDEFEND_EDITION is not read.
export function currentEdition(): Edition { return 'community'; }
export function isCommunityEdition(): boolean { return true; }
