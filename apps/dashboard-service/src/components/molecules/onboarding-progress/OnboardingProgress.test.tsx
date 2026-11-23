import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

const ed = vi.hoisted(() => ({ edition: 'cloud' as string }));
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));

import { ONBOARDING_CLOUD_CTA_SLOT_ID, OnboardingProgress } from './OnboardingProgress';
import { upsellLink } from '@/edition/upsell/upsellLink';

afterEach(() => {
  ed.edition = 'cloud';
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      if (key === 'components.cybeGuide.progress.title') return 'Getting started';
      if (key === 'components.cybeGuide.progress.complete') return `${opts?.count}/${opts?.total} completed`;
      return key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/server/hooks/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({
    steps: [
      { id: 'org_created', labelKey: 'step1', completed: true },
      { id: 'first_project', labelKey: 'step2', completed: false },
    ],
    completedCount: 1,
    totalCount: 2,
    percentage: 50,
  }),
}));

describe('OnboardingProgress', () => {
  it('renders the progress title', () => {
    render(<OnboardingProgress />);
    expect(screen.getByText('Getting started')).toBeInTheDocument();
  });

  it('shows completion count', () => {
    render(<OnboardingProgress />);
    // Collapsed view (default) renders "1/2"; the "1/2 completed" wording
    // only appears in the expanded popup. Test the collapsed text since
    // that's what users see by default.
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('shows a progress bar', () => {
    render(<OnboardingProgress />);
    expect(screen.getByTestId('progress-bar')).toBeInTheDocument();
  });

  /*
   * In Community, the opened list is not a floating panel
   * (`absolute bottom-full z-50`) drawn over the navigation and the
   * organisation selector above it, with a full-screen backdrop: it opens
   * in place, in the checklist's own block, and pushes what follows (the rail
   * scrolls if it must). jsdom has no layout: the structure and the classes
   * say it.
   */
  /*
   * The cloud keeps its floating panel: above the bar, a full-screen backdrop that
   * closes it, and its own header with the « x/y completed » count.
   */
  it('in the cloud, opens the floating panel above the bar, with its header and a backdrop that closes it', async () => {
    ed.edition = 'cloud';
    const { container } = render(<OnboardingProgress />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('px-3', 'pb-1', 'relative');
    fireEvent.click(screen.getByRole('button', { name: /Getting started/ }));
    const panel = screen.getByText('1/2 completed').closest('.absolute') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel).toHaveClass('absolute', 'bottom-full', 'left-0', 'right-0', 'mb-2', 'z-50');
    expect(screen.getByText('step2')).toBeInTheDocument();
    const backdrop = container.querySelector('.fixed.inset-0.z-40') as HTMLElement;
    expect(backdrop).not.toBeNull();
    expect(screen.getByRole('button', { name: /Getting started/ })).not.toHaveAttribute('aria-expanded');
    fireEvent.click(backdrop);
    // The panel leaves after its exit animation.
    await waitFor(() => expect(screen.queryByText('1/2 completed')).toBeNull());
  });

  it('in Community, opens its steps in place, inside its own block, never as an overlay', () => {
    ed.edition = 'community';
    const { container } = render(<OnboardingProgress />);
    const root = container.firstElementChild as HTMLElement;
    const toggle = screen.getByRole('button', { name: /Getting started/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('onboarding-steps')).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByTestId('onboarding-steps');
    expect(toggle).toHaveAttribute('aria-controls', list.id);
    expect(root).toContainElement(list);
    // In the flow, after its toggle: no positioning lifts it out of the block.
    expect(toggle.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (let el: HTMLElement | null = list; el && el !== root.parentElement; el = el.parentElement) {
      expect(el.className).not.toMatch(/\b(absolute|fixed|bottom-full|-mx-\d|z-\d+)\b/);
    }
    // No backdrop over the page.
    expect(container.querySelector('.fixed')).toBeNull();
    expect(screen.getByText('step2')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('in Community, closes the open list on Escape', () => {
    ed.edition = 'community';
    render(<OnboardingProgress />);
    const toggle = screen.getByRole('button', { name: /Getting started/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  /*
   * The Open Source checklist ends with an invitation to the
   * cloud. It is not a step: nothing to tick, and the x/y count stays the steps'.
   */
  it('in Community, ends the open list with a link to CybeDefend Cloud that is not a step', () => {
    ed.edition = 'community';
    render(<OnboardingProgress />);
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Getting started/ }));
    const list = screen.getByTestId('onboarding-steps');
    const cta = screen.getByRole('link', { name: /components\.cybeGuide\.cloudCta\.label.*components\.upsell\.opensInNewTab/ });
    expect(list).toContainElement(cta);
    // The last thing of the list, after every step.
    expect(list.lastElementChild).toContainElement(cta);
    expect(cta.compareDocumentPosition(screen.getByText('step2')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(cta).toHaveAttribute('href', upsellLink(ONBOARDING_CLOUD_CTA_SLOT_ID, '/pricing'));
    expect(cta).toHaveAttribute('target', '_blank');
    expect(cta).toHaveAttribute('rel', 'noopener noreferrer');
    // Not a step: the count is the steps', and the link is no tickable button.
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(cta.closest('button')).toBeNull();
  });

  it('in the cloud, has no link to the cloud in its panel', () => {
    ed.edition = 'cloud';
    render(<OnboardingProgress />);
    fireEvent.click(screen.getByRole('button', { name: /Getting started/ }));
    expect(screen.getByText('step2')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/cloudCta/)).toBeNull();
  });
});
