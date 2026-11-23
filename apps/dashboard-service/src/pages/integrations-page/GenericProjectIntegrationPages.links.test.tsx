import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { IntegrationPageConfig } from '@/server/interfaces/IntegrationProvider';

/**
 * The way back of each page of the project import: the steps go back to the
 * provider's onboarding page, and the onboarding page goes back to the AppSec
 * home — never to the root, which would hand the account to the landing rule.
 */

const h = vi.hoisted(() => {
  const configs: IntegrationPageConfig[] = [];
  // Each shared page is replaced by this: it records the config it was handed.
  const capture = ({ config }: { config: IntegrationPageConfig }) => {
    configs.push(config);
    return null;
  };
  return { configs, capture };
});

vi.mock('./shared/ProjectIntegrationOnboardingPage', () => ({ ProjectIntegrationOnboardingPage: h.capture }));
vi.mock('./shared/ProjectIntegrationLinkExistingPage', () => ({ ProjectIntegrationLinkExistingPage: h.capture }));
vi.mock('./shared/ProjectIntegrationCreateProjectsPage', () => ({ ProjectIntegrationCreateProjectsPage: h.capture }));
vi.mock('@/server/hooks/useGithubIntegrationAdapter', () => ({ useGithubIntegrationAdapter: vi.fn() }));
vi.mock('@/server/hooks/useGitlabIntegrationAdapter', () => ({ useGitlabIntegrationAdapter: vi.fn() }));

import { GenericProjectIntegrationOnboardingPage } from './GenericProjectIntegrationOnboardingPage';
import { GenericProjectIntegrationLinkExistingPage } from './GenericProjectIntegrationLinkExistingPage';
import { GenericProjectIntegrationCreateProjectsPage } from './GenericProjectIntegrationCreateProjectsPage';

const backToPathAt = (url: string, page: React.ReactElement): string => {
  h.configs.length = 0;
  render(<MemoryRouter initialEntries={[url]}>{page}</MemoryRouter>);
  const config = h.configs.at(-1);
  if (!config) throw new Error('the shared page was not rendered');
  return config.backToPath;
};

beforeEach(() => {
  h.configs.length = 0;
});

describe('the way back of the project import pages', () => {
  it.each(['github', 'gitlab'] as const)('goes from the %s onboarding page to the AppSec home', (provider) => {
    expect(
      backToPathAt(`/appsec/project/integration/${provider}`, <GenericProjectIntegrationOnboardingPage />),
    ).toBe('/appsec');
  });

  it.each(['github', 'gitlab'] as const)('goes from linking %s projects back to its onboarding page', (provider) => {
    expect(
      backToPathAt(`/appsec/project/integration/${provider}/link`, <GenericProjectIntegrationLinkExistingPage />),
    ).toBe(`/appsec/project/integration/${provider}`);
  });

  it.each(['github', 'gitlab'] as const)('goes from creating %s projects back to its onboarding page', (provider) => {
    expect(
      backToPathAt(`/appsec/project/integration/${provider}/create`, <GenericProjectIntegrationCreateProjectsPage />),
    ).toBe(`/appsec/project/integration/${provider}`);
  });

  it('still reads the provider from a former URL, rendered for the one commit of its redirect', () => {
    expect(
      backToPathAt('/project/integration/gitlab/link', <GenericProjectIntegrationLinkExistingPage />),
    ).toBe('/appsec/project/integration/gitlab');
  });
});
