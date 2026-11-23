import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import Badge from './Badge';

// Regression: the "ML Model" badge on the AI-BOM inventory used the
// `primary` variant, which rendered `dark:text-primary` on a `dark:bg-primary/20`
// surface. The brand `primary` colour (#1a1a2e) is a near-black navy, so in dark
// mode the badge was dark-navy-text on a dark background — invisible. Every Badge
// variant must therefore carry a legible dark-mode text colour; `primary` was the
// only one reusing the dark brand colour as its dark-mode text.
describe('Badge — primary variant dark mode', () => {
  it('renders the primary-variant text with a legible dark-mode colour, not the dark brand navy', () => {
    render(<Badge variant="primary">ML Model</Badge>);
    const el = screen.getByText('ML Model');

    // Must NOT reuse the near-black brand navy (`dark:text-primary`) as dark text.
    expect(el.className).not.toMatch(/dark:text-primary(?![\w-])/);
    // Must expose an explicit, legible dark-mode text colour.
    expect(el.className).toMatch(/dark:text-white/);
  });

  it('keeps its light-mode brand text colour unchanged', () => {
    render(<Badge variant="primary">ML Model</Badge>);
    // Light mode still uses the brand navy on the faint tint — only dark mode changed.
    expect(screen.getByText('ML Model').className).toMatch(/(?<!dark:)text-primary\b/);
  });
});
