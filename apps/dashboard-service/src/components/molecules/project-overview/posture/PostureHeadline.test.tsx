import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PostureHeadline from './PostureHeadline';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fr' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

describe('PostureHeadline', () => {
  it('writes one sentence, figure by figure, the figures in the interface language', () => {
    render(
      <PostureHeadline
        parts={[
          { value: 12345, label: 'vulnérabilités ouvertes' },
          { value: 30, label: 'critiques ou élevées' },
          { value: 134, label: 'résolues à ce jour' },
        ]}
      />,
    );
    const sentence = screen.getByTestId('posture-headline');
    expect(sentence).toHaveTextContent(/12\s345 vulnérabilités ouvertes, 30 critiques ou élevées, 134 résolues à ce jour\./);
    expect(sentence).not.toHaveTextContent('12,345');
  });

  it('joins a part with its own word instead of a comma', () => {
    render(
      <PostureHeadline
        parts={[
          { value: 12, label: 'projets' },
          { value: 4, label: 'équipes', joiner: 'dans' },
          { value: 550, label: 'vulnérabilités ouvertes' },
        ]}
      />,
    );
    expect(screen.getByTestId('posture-headline')).toHaveTextContent('12 projets dans 4 équipes, 550 vulnérabilités ouvertes.');
  });

  it('renders no sentence without parts, only what it was given around it', () => {
    render(<PostureHeadline parts={[]} meta={<span>main</span>} />);
    expect(screen.queryByTestId('posture-headline')).toBeNull();
    expect(screen.getByText('main')).toBeInTheDocument();
  });
});
