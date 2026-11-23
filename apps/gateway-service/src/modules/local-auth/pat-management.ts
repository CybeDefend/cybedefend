import { HttpException, HttpStatus } from '@nestjs/common';
import { isCommunityEdition } from 'src/edition/edition';

export const PAT_FORBIDDEN_FOR_PAT_MANAGEMENT =
  'PAT_FORBIDDEN_FOR_PAT_MANAGEMENT';

/** 403 PAT_FORBIDDEN_FOR_PAT_MANAGEMENT, the code as message and `code`. */
export function patManagementForbidden(): HttpException {
  return new HttpException(
    {
      message: PAT_FORBIDDEN_FOR_PAT_MANAGEMENT,
      code: PAT_FORBIDDEN_FOR_PAT_MANAGEMENT,
    },
    HttpStatus.FORBIDDEN,
  );
}

/**
 * In the Community edition, a caller authenticated by a personal access token
 * (`req.user.via === 'pat'`) cannot list, create, delete or rename personal
 * access tokens on any route: a leaked `cdp_` token must not make itself
 * permanent. The cloud edition is unchanged. The inventory of the routes is
 * pinned by pat-management.inventory.spec.ts.
 */
export function refusePatCallerInCommunity(
  user: { via?: string } | undefined,
): void {
  if (isCommunityEdition() && user?.via === 'pat') {
    throw patManagementForbidden();
  }
}
