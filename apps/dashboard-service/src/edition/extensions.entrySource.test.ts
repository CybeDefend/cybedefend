import { describe, expect, it } from 'vitest';
import { EMPTY_EXTENSIONS } from './extensions';

describe('EMPTY_EXTENSIONS', () => {
  it('has no entry link: no link states a product space in the Community Edition', () => {
    expect(EMPTY_EXTENSIONS.entrySource).toBeNull();
  });
});

describe('EMPTY_EXTENSIONS.ShellQuestions', () => {
  it('is null: the shell asks no product question in the Community Edition', () => {
    expect(EMPTY_EXTENSIONS.ShellQuestions).toBeNull();
  });
});

describe('EMPTY_EXTENSIONS.publicApiUrl', () => {
  it('is null: the Community Edition calls its own instance', () => {
    expect(EMPTY_EXTENSIONS.publicApiUrl).toBeNull();
  });
});
