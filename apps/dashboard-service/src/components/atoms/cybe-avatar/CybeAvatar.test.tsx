import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CybeAvatar } from './CybeAvatar';

describe('CybeAvatar', () => {
  it('renders the avatar image', () => {
    render(<CybeAvatar />);
    const img = screen.getByAltText('Cybe');
    expect(img).toBeInTheDocument();
  });

  it('applies the correct size for each variant', () => {
    const sizes = { xs: 24, sm: 32, md: 40, lg: 56, xl: 80 } as const;
    for (const [size, px] of Object.entries(sizes)) {
      const { unmount } = render(
        <CybeAvatar size={size as keyof typeof sizes} data-testid={`avatar-${size}`} />
      );
      const wrapper = screen.getByTestId(`avatar-${size}`);
      expect(wrapper).toHaveStyle({ width: `${px}px`, height: `${px}px` });
      unmount();
    }
  });

  it('defaults to md size', () => {
    render(<CybeAvatar data-testid="avatar-default" />);
    const wrapper = screen.getByTestId('avatar-default');
    expect(wrapper).toHaveStyle({ width: '40px', height: '40px' });
  });

  it('shows status badge when showStatus is true', () => {
    render(<CybeAvatar showStatus data-testid="avatar-status" />);
    const badge = screen.getByTestId('avatar-status').querySelector('[data-status-badge]');
    expect(badge).toBeInTheDocument();
  });

  it('does not show status badge by default', () => {
    render(<CybeAvatar data-testid="avatar-no-status" />);
    const badge = screen.getByTestId('avatar-no-status').querySelector('[data-status-badge]');
    expect(badge).toBeNull();
  });

  it('applies pulse animation when pulse prop is true', () => {
    render(<CybeAvatar pulse data-testid="avatar-pulse" />);
    const wrapper = screen.getByTestId('avatar-pulse');
    expect(wrapper.querySelector('[data-pulse]')).toBeInTheDocument();
  });

  it('merges custom className', () => {
    render(<CybeAvatar className="my-custom-class" data-testid="avatar-custom" />);
    expect(screen.getByTestId('avatar-custom')).toHaveClass('my-custom-class');
  });
});
