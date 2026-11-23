import { isCodeGraphSupported } from './code-graph-support.util';

describe('isCodeGraphSupported', () => {
  it('is optimistic when no language is known', () => {
    expect(isCodeGraphSupported()).toBe(true);
    expect(isCodeGraphSupported([])).toBe(true);
  });

  it('accepts canonical languages (any case)', () => {
    expect(isCodeGraphSupported(['Python'])).toBe(true);
    expect(isCodeGraphSupported(['python'])).toBe(true);
    expect(isCodeGraphSupported(['Go', 'Java'])).toBe(true);
  });

  it('normalises scanner spellings and aliases', () => {
    expect(isCodeGraphSupported(['C#'])).toBe(true);
    expect(isCodeGraphSupported(['C++'])).toBe(true);
    expect(isCodeGraphSupported(['JSX'])).toBe(true);
    expect(isCodeGraphSupported(['TSX'])).toBe(true);
    expect(isCodeGraphSupported(['golang'])).toBe(true);
    expect(isCodeGraphSupported(['kt'])).toBe(true);
    expect(isCodeGraphSupported(['JavaScript (React)'])).toBe(true);
  });

  it('splits combined language strings', () => {
    expect(isCodeGraphSupported(['JavaScript / TypeScript'])).toBe(true);
  });

  it('hides when every detected language is unsupported', () => {
    expect(isCodeGraphSupported(['Terraform'])).toBe(false);
    expect(isCodeGraphSupported(['YAML', 'JSON'])).toBe(false);
    expect(isCodeGraphSupported(['Solidity'])).toBe(false);
    expect(isCodeGraphSupported(['Generic'])).toBe(false);
  });

  it('shows when at least one detected language is supported (mixed)', () => {
    expect(isCodeGraphSupported(['Terraform', 'Go'])).toBe(true);
  });
});
