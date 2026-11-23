import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Card from './Card';

describe('Card — as', () => {
  it('renders a div by default', () => {
    render(<Card data-testid="card">Body</Card>);

    expect(screen.getByTestId('card').tagName).toBe('DIV');
  });

  it.each(['section', 'aside', 'article'] as const)('renders a %s when asked', (as) => {
    render(
      <Card as={as} data-testid="card" aria-label="Region" variant="outlined" padding="sm">
        Body
      </Card>,
    );

    const card = screen.getByTestId('card');
    expect(card.tagName).toBe(as.toUpperCase());
    expect(card).toHaveAttribute('aria-label', 'Region');
    expect(card).toHaveClass('rounded-2xl', 'p-4', 'border-gray-200');
    expect(card).toHaveTextContent('Body');
  });
});

describe('CardTitle — as', () => {
  it('renders an h3 by default and the requested heading level otherwise', async () => {
    const { CardTitle } = await import('./Card');
    const { rerender } = render(<CardTitle>Rules</CardTitle>);
    expect(screen.getByRole('heading', { level: 3, name: 'Rules' })).toBeInTheDocument();
    rerender(<CardTitle as="h2">Rules</CardTitle>);
    expect(screen.getByRole('heading', { level: 2, name: 'Rules' })).toBeInTheDocument();
  });
});
