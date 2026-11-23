/**
 * Extension token: the live end-of-life
 * lookup ContainerService consults for an image's base OS. Only an ee module
 * supplies it (endoflife.date); when the token is absent — the Community
 * Edition — the static table of modules/container/os-eol.ts answers, as it
 * already did wherever the live lookup was not wired.
 */
export const OS_END_OF_LIFE = 'OS_END_OF_LIFE';

export interface OsEndOfLifeLookup {
  isOsEndOfLife(
    family: string | undefined,
    version: string | undefined,
  ): Promise<boolean | null>;
}
