import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Button from './Button';

/**
 * On a phone every Button draws an invisible 44 px reach (`::after`). A
 * labelled button only needs the height: it is already wide. A button with
 * no word in it (a glyph alone, named by `aria-label`) is 28-32 px wide, so
 * its reach must grow both ways (verify finding T4b-2). The detection reads
 * the children, not the props, so a word nested in an element still counts.
 */
describe('Button phone reach', () => {
  it('grows both ways for an icon-only button, in height only for a labelled one', () => {
    render(
      <>
        <Button aria-label="Delete" data-testid="glyph-child">
          <svg aria-hidden="true" />
        </Button>
        <Button aria-label="Add" icon={<svg aria-hidden="true" />} data-testid="icon-prop" />
        <Button data-testid="word">Delete</Button>
        <Button data-testid="nested-word">
          <svg aria-hidden="true" />
          <span>Delete</span>
        </Button>
      </>,
    );

    for (const id of ['glyph-child', 'icon-prop']) {
      expect(screen.getByTestId(id).className).toContain('max-md:after:w-11');
    }
    for (const id of ['word', 'nested-word']) {
      const classes = screen.getByTestId(id).className;
      expect(classes).toContain('max-md:after:h-11');
      expect(classes).not.toContain('max-md:after:w-11');
    }
  });

  it('leaves the frozen row variant without any reach', () => {
    render(
      <Button variant="row" data-testid="row">
        <svg aria-hidden="true" />
      </Button>,
    );
    expect(screen.getByTestId('row').className).not.toContain('max-md:after:');
  });
});
