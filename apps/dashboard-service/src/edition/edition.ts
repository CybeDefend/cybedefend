export const EDITIONS: readonly ['community', 'cloud', 'enterprise'] = [
  'community',
  'cloud',
  'enterprise',
];

export type Edition = (typeof EDITIONS)[number];

/**
 * Unset or empty means the hosted build ('cloud'); any other value outside the
 * three editions throws at module load, so a typo in the environment fails the
 * build instead of silently running the wrong edition.
 */
export function parseEdition(raw: string | undefined): Edition {
  if (raw === undefined || raw === '') return 'cloud';
  if ((EDITIONS as readonly string[]).includes(raw)) return raw as Edition;
  throw new Error(`VITE_EDITION must be one of community, cloud, enterprise (got "${raw}")`);
}

// Community Edition: the edition is fixed; VITE_EDITION is not read.
export const EDITION: Edition = 'community';
