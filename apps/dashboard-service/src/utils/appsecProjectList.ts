import { EDITION } from '@/edition/edition';
import { APPSEC_PROJECTS_PATH, productHome } from '@/utils/product';

/**
 * The AppSec project list, for a link that means « the projects » rather than
 * « the home ». In the cloud the home is the list and the link is what it
 * always was; in the Community Edition the home is « Get started » and the
 * list is at its own URL. Read at call
 * time, so a test can switch the edition.
 */
export const appsecProjectListPath = (): string =>
  EDITION === 'community' ? APPSEC_PROJECTS_PATH : productHome('appsec');
