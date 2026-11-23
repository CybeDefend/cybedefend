import { Injectable } from '@nestjs/common';
import type { OrganizationProfilePort } from '../ports/organization-profile.port';

/**
 * The community organisation: the core fields alone, in its answers and in
 * the rows it writes.
 */
@Injectable()
export class CommunityOrganizationProfile implements OrganizationProfilePort {
  answerFields(): Record<string, unknown> {
    return {};
  }

  creationColumns(): Record<string, never> {
    return {};
  }

  updateColumns(): Record<string, never> {
    return {};
  }
}
