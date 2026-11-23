import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import en from '@/i18n/locales/en/components/integrationNotConfigured.json';
import fr from '@/i18n/locales/fr/components/integrationNotConfigured.json';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import IntegrationNotConfiguredMessage, {
  OPTIONAL_INTEGRATIONS_GUIDE_URL,
} from './IntegrationNotConfiguredMessage';

describe('IntegrationNotConfiguredMessage', () => {
  it.each(['github', 'gitlab', 'jira', 'linear'] as const)(
    'says %s is not configured and links to the Optional integrations section of the guide',
    (provider) => {
      render(<IntegrationNotConfiguredMessage provider={provider} />);
      expect(screen.getByText(/is not configured on this instance\./)).toBeInTheDocument();
      const link = screen.getByRole('link', { name: /Optional integrations/ });
      expect(link).toHaveAttribute('href', OPTIONAL_INTEGRATIONS_GUIDE_URL);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    },
  );

  it('points to the « Optional integrations » heading of the public self-hosting guide', () => {
    expect(OPTIONAL_INTEGRATIONS_GUIDE_URL).toBe(
      'https://github.com/CybeDefend/cybedefend/blob/main/deploy/community/README.md#optional-integrations',
    );
  });

  it('has the link text in English and French', () => {
    expect(en.components.integrationNotConfigured.guideLink).toMatch(/Optional integrations/);
    expect(fr.components.integrationNotConfigured.guideLink).toMatch(/Optional integrations/);
  });
});
