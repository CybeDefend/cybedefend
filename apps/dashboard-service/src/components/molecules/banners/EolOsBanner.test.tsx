import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import EolOsBanner from './EolOsBanner';

// An image built on an end-of-life base OS scans with ZERO
// vulnerabilities because the distribution stopped publishing advisories.
// The user must be told loudly that "0" means "detection impossible".

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

describe('EolOsBanner', () => {
  it('renders a block alert naming the OS and explaining that detection is incomplete', () => {
    render(<EolOsBanner osFamily="alpine" osName="3.18.12" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Base OS no longer supported');
    expect(alert).toHaveTextContent('alpine 3.18.12');
    expect(alert).toHaveTextContent('vulnerability detection is incomplete');
  });

  it('renders a compact inline badge for table rows', () => {
    render(<EolOsBanner variant="inline" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'OS end of life: detection incomplete',
    );
    expect(screen.queryByText('Base OS no longer supported')).toBeNull();
  });
});
