// The finding's code viewers cap their height at 400 px. Their vertical
// overflow was hidden, so a block longer than ~16 lines was cut with no way to
// reach the rest, and a trackpad or wheel scroll over it moved the panel behind
// instead (a finding on lines 80-106 showed only 80-95).
// Past the cap, the viewer must scroll its own lines.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import CodeSnippet from './CodeSnippet';
import CodeSnippetDataFlow from './CodeSnippetDataFlow';

const lines = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ line: from + i, content: `line ${from + i}` }));

/** The element that caps the viewer at 400 px. */
const heightCap = (root: HTMLElement): HTMLElement => {
  const cap = Array.from(root.querySelectorAll<HTMLElement>('*')).find((el) => el.style.maxHeight === '400px');
  if (!cap) throw new Error('no element caps the viewer at 400px');
  return cap;
};

// The viewers render the customer's source code: their root carries the
// `content` marker, which every line inherits.
describe('the finding code viewers mark the code as customer content', () => {
  it('CodeSnippet', () => {
    const { container } = render(<CodeSnippet code={lines(1, 3)} language="js" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-sensitive')).toBe('content');
    expect(root.contains(container.querySelector('pre'))).toBe(true);
  });

  it('CodeSnippetDataFlow (every data-flow step)', () => {
    const { container } = render(
      <CodeSnippetDataFlow code={lines(1, 3)} language="python" lineToHighlight={2} nameHighlight="" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-sensitive')).toBe('content');
    expect(root.contains(container.querySelector('pre'))).toBe(true);
  });
});

describe('the finding code viewers scroll vertically past their height cap', () => {
  it('CodeSnippet keeps every line of a long block reachable', () => {
    const { container } = render(
      <CodeSnippet code={lines(80, 106)} language="hcl" highlightedLines={[80, 106]} startingLineNumber={80} />,
    );

    // Prism splits a line into tokens: read the rendered text, not one element.
    expect(container.textContent).toContain('line 106');
    const cap = heightCap(container);
    expect(cap.style.overflowY).toBe('auto');
    expect(cap.style.overflowX).toBe('auto');
  });

  it('CodeSnippetDataFlow keeps every line of a long step reachable', () => {
    const { container } = render(
      <CodeSnippetDataFlow code={lines(1, 40)} language="python" lineToHighlight={20} nameHighlight="" />,
    );

    expect(container.textContent).toContain('line 40');
    const cap = heightCap(container);
    expect(cap.classList.contains('overflow-y-auto')).toBe(true);
    expect(cap.classList.contains('overflow-y-hidden')).toBe(false);
  });
});
