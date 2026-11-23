import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StoredReportTypeLink from './StoredReportTypeLink';

// Echo the leaf key; surface count + interpolated type so we can assert them.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && 'count' in o
        ? `${k.split('.').pop()}:${o.count}:${o.type}`
        : (k.split('.').pop() ?? k),
  }),
}));

describe('StoredReportTypeLink', () => {
  it('renders nothing when there are no stored reports of this type', () => {
    const { container } = render(
      <StoredReportTypeLink kind="owasp" count={0} onOpen={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the count + localized type and opens the drawer on click', () => {
    const onOpen = vi.fn();
    render(<StoredReportTypeLink kind="owasp" count={3} onOpen={onOpen} />);

    const btn = screen.getByRole('button');
    // viewTypeReports:<count>:<type-label> — type resolves via reportTypes.owasp.
    expect(btn).toHaveTextContent('3');
    expect(btn).toHaveTextContent('owasp');

    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('maps eu_ai_act to the aiAct label and falls back for unknown kinds', () => {
    const { rerender } = render(
      <StoredReportTypeLink kind="eu_ai_act" count={1} onOpen={vi.fn()} />,
    );
    expect(screen.getByRole('button')).toHaveTextContent('aiAct');

    rerender(
      <StoredReportTypeLink kind="scanner_type" count={2} onOpen={vi.fn()} />,
    );
    // Unknown-to-map kind → uppercased raw kind as the type label.
    expect(screen.getByRole('button')).toHaveTextContent('SCANNER_TYPE');
  });
});
