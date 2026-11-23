import { describe, it, expect } from 'vitest';
import { projectIntegrationPath } from './integrationPaths';

describe('projectIntegrationPath', () => {
  it('puts the onboarding page of each provider under the AppSec prefix', () => {
    expect(projectIntegrationPath('github')).toBe('/appsec/project/integration/github');
    expect(projectIntegrationPath('gitlab')).toBe('/appsec/project/integration/gitlab');
  });

  it('puts each step of the import under it too', () => {
    expect(projectIntegrationPath('github', 'link')).toBe('/appsec/project/integration/github/link');
    expect(projectIntegrationPath('gitlab', 'create')).toBe('/appsec/project/integration/gitlab/create');
  });
});
