import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DetectionSourceBadge from './DetectionSourceBadge';

// A container detection is either reported by the scanner pod or
// matched by CybeDefend against the OSV database from the package inventory.
// The second kind must be recognisable at a glance; the first stays as today.

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

describe('DetectionSourceBadge', () => {
  it('labels an OSV-matched detection', () => {
    render(<DetectionSourceBadge detectionSource="osv" />);

    const badge = screen.getByLabelText('Matched by CybeDefend (OSV)');
    expect(badge).toHaveTextContent('OSV match');
  });

  it('renders nothing for a scanner-reported detection (the default, no noise)', () => {
    const { container } = render(<DetectionSourceBadge detectionSource="scanner" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the source is unknown', () => {
    const { container } = render(<DetectionSourceBadge detectionSource={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
