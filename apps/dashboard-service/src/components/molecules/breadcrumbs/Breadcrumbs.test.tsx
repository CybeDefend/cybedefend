import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

// Resolve keys to the key itself so the test asserts *which* key is used,
// independently of the French wording, which may be retuned later.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import { Breadcrumbs } from './Breadcrumbs';
import { PRODUCTS } from '@/utils/product';

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Breadcrumbs />
    </MemoryRouter>,
  );

const PROJECT = '/appsec/project/00000000-0000-4000-8000-000000000001';

/** The capitalised slugs that leaked: two segments, and each product space's own prefix but the Platform's. */
const RAW_SLUGS = new RegExp(
  ['Code-graph', 'Sast', ...PRODUCTS.filter((product) => product !== 'appsec').map((p) => p[0].toUpperCase() + p.slice(1))].join('|'),
);

describe('Breadcrumbs', () => {
  /**
   * The trail used to be built by capitalising raw URL segments, which put
   * "Sast", "Code-graph", a space's own slug, "Reports" and "Settings" in front of
   * users. Every segment must resolve through a translation key instead.
   */
  it.each([
    [`${PROJECT}/sast`, 'navigation.breadcrumb.sast'],
    [`${PROJECT}/code-graph`, 'navigation.breadcrumb.code-graph'],
    [`${PROJECT}/reports`, 'navigation.breadcrumb.reports'],
    [`${PROJECT}/compliance`, 'navigation.breadcrumb.compliance'],
    [`${PROJECT}/settings`, 'navigation.breadcrumb.settings'],
    ['/appsec/autofix', 'navigation.breadcrumb.autofix'],
    ['/appsec/reports', 'navigation.breadcrumb.reports'],
    ['/organization/settings/teams', 'navigation.breadcrumb.teams'],
    ['/organization/settings/policies', 'navigation.breadcrumb.policies'],
  ])('resolves %s through a translation key', (path, key) => {
    at(path);
    expect(screen.getByText(key)).toBeInTheDocument();
  });

  it('labels the project segment through a key rather than the raw word', () => {
    at(`${PROJECT}/sast`);
    expect(screen.getByText('navigation.breadcrumb.project')).toBeInTheDocument();
  });

  it('never renders a raw URL segment', () => {
    const { container } = at(`${PROJECT}/code-graph`);
    // A capitalised slug leaking through is the exact defect being fixed.
    expect(container.textContent).not.toMatch(RAW_SLUGS);
  });

  it('falls back to the raw segment for a route with no key, without crashing', () => {
    const { container } = at('/some-unmapped-route');
    expect(container.textContent).toContain('some-unmapped-route');
  });
});
