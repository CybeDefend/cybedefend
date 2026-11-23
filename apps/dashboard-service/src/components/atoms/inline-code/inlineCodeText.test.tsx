import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InlineCodeText, splitInlineCode } from './inlineCodeText';

describe('splitInlineCode', () => {
  it('cuts a sentence into its text and its quoted code', () => {
    expect(splitInlineCode('Mount `app.use(requireAuth)` before the routes.')).toEqual([
      { code: false, text: 'Mount ' },
      { code: true, text: 'app.use(requireAuth)' },
      { code: false, text: ' before the routes.' },
    ]);
  });

  it('reads several spans and a span at either end', () => {
    expect(splitInlineCode('`a` or `b`')).toEqual([
      { code: true, text: 'a' },
      { code: false, text: ' or ' },
      { code: true, text: 'b' },
    ]);
  });

  it('leaves a lone backtick, an empty pair and a text without code as they came', () => {
    expect(splitInlineCode('it`s fine')).toEqual([{ code: false, text: 'it`s fine' }]);
    expect(splitInlineCode('an `` empty pair')).toEqual([{ code: false, text: 'an `` empty pair' }]);
    expect(splitInlineCode('plain words')).toEqual([{ code: false, text: 'plain words' }]);
    expect(splitInlineCode('')).toEqual([]);
  });

  it('never runs a span across a line break', () => {
    expect(splitInlineCode('one `half\nand` the rest')).toEqual([{ code: false, text: 'one `half\nand` the rest' }]);
  });
});

describe('InlineCodeText', () => {
  it('prints quoted code as code and the rest as text, never as markup', () => {
    const { container } = render(<InlineCodeText text={'Use `<b>x</b>` here'} />);
    const code = container.querySelector('code');
    expect(code?.textContent).toBe('<b>x</b>');
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toBe('Use <b>x</b> here');
  });
});
