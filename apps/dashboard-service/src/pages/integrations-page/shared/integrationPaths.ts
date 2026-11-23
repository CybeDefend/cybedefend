import type { IntegrationProvider } from '@/server/interfaces/IntegrationProvider';
import { appsecPath } from '@/utils/product';

/** The steps of a project import, after the provider's onboarding page. */
export type IntegrationStep = 'link' | 'create';

/**
 * A page of the project import through GitHub or GitLab. It is an AppSec page,
 * so it lives under the AppSec prefix. The provider's own callback
 * (`/integrations/<provider>/callback`) is registered at the provider and is
 * never built here.
 */
export const projectIntegrationPath = (provider: IntegrationProvider, step?: IntegrationStep): string =>
  appsecPath(step ? `/project/integration/${provider}/${step}` : `/project/integration/${provider}`);
