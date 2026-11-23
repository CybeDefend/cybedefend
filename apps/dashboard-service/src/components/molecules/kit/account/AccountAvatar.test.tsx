import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import AccountAvatar from './AccountAvatar';

/**
 * The account's picture in a zinc-kit shell (the avatar is the only image of
 * the account menu). Without a picture — or when it fails to
 * load — the initial on a zinc disc: the shared `Avatar` atom paints it on the
 * accent in bold, which this space does not do.
 */
describe('AccountAvatar', () => {
  it('shows the picture, round, at 32 px', () => {
    const { container } = render(<AccountAvatar src="https://example.test/ada.png" name="Ada Lovelace" />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).toHaveAttribute('src', 'https://example.test/ada.png');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img).toHaveClass('h-8', 'w-8', 'rounded-full', 'object-cover');
    // Decorative by default: the name is written beside it.
    expect(img).toHaveAttribute('alt', '');
  });

  it('names the picture when asked to', () => {
    const { getByRole } = render(<AccountAvatar src="https://example.test/ada.png" name="Ada Lovelace" labelled />);
    expect(getByRole('img', { name: 'Ada Lovelace' })).toBeInTheDocument();
  });

  it('falls back to the initial on a zinc disc, never the accent nor bold', () => {
    const { container } = render(<AccountAvatar name="ada lovelace" />);
    const disc = container.firstElementChild as HTMLElement;
    expect(disc).toHaveTextContent('A');
    expect(disc).toHaveClass('rounded-full', 'bg-zinc-200', 'dark:bg-white/[0.08]', 'font-medium');
    expect(disc.className).not.toMatch(/secondary|font-bold/);
    expect(disc).toHaveAttribute('aria-hidden', 'true');
  });

  it('falls back to the initial when the picture fails to load', () => {
    const { container } = render(<AccountAvatar src="https://example.test/broken.png" name="Ada" />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('A');
  });

  it('draws a question mark for an account with no name yet', () => {
    const { container } = render(<AccountAvatar name="" />);
    expect(container).toHaveTextContent('?');
  });

  it('comes in 28 px for tight rows', () => {
    const { container } = render(<AccountAvatar name="Ada" size="sm" />);
    expect(container.firstElementChild).toHaveClass('h-7', 'w-7');
  });
});
