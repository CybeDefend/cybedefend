import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { translate } from '@/test/i18n-mock';
import { AuthFrame } from './AuthFrame';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

function renderFrame() {
  return render(
    <MemoryRouter>
      <AuthFrame title="Set up this instance" subtitle="The first administrator.">
        <p>form</p>
      </AuthFrame>
    </MemoryRouter>,
  );
}

describe('AuthFrame, the frame of the Community sign-in pages', () => {
  it('shows the CybeDefend AppSec logo, named for assistive technologies', () => {
    renderFrame();
    const logo = screen.getByRole('img', { name: translate('pages.communityAuth.brand') });
    // Both theme variants are in the logo, decorative themselves: one name, read once.
    const images = logo.querySelectorAll('img');
    expect(images.length).toBe(2);
    images.forEach((image) => expect(image.getAttribute('alt')).toBe(''));
    expect([...images].map((image) => image.getAttribute('src'))).toEqual(['/logo.webp', '/logo-white.webp']);
  });

  it('names the product next to the wordmark, in the accent with its dark companion', () => {
    renderFrame();
    const logo = screen.getByRole('img', { name: translate('pages.communityAuth.brand') });
    const product = within(logo.parentElement as HTMLElement).getByText(translate('pages.communityAuth.product'));
    expect(product.className).toContain('text-secondary');
    expect(product.className).toContain('dark:text-secondary-light');
  });

  it('gives the page title as its heading and keeps the subtitle and the content', () => {
    renderFrame();
    expect(screen.getByRole('heading', { level: 1, name: 'Set up this instance' })).toBeTruthy();
    expect(screen.getByText('The first administrator.')).toBeTruthy();
    expect(screen.getByText('form')).toBeTruthy();
  });

  it('carries the AppSec accent, whatever space the account was in before', () => {
    renderFrame();
    expect(screen.getByRole('main').getAttribute('data-product')).toBe('appsec');
  });
});
