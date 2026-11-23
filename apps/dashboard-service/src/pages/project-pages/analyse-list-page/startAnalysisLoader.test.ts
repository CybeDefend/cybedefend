import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '@/i18n';
import en from '@/i18n/locales/en/errors/_self.json';
import { archiveStartErrorMessage, repositoryStartErrorMessage } from './startAnalysisLoader';

const refused = (status: number, message: unknown = 'Internal: scanner pool exhausted') => ({
  message: `Request failed with status code ${status}`,
  response: { status, data: { message } },
});

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('repositoryStartErrorMessage', () => {
  it('shows a fixed sentence by status, never the server or axios text', () => {
    expect(repositoryStartErrorMessage(refused(403), 'generic')).toBe(en.errors.api.notAllowed);
    expect(repositoryStartErrorMessage(refused(503), 'generic')).toBe(en.errors.api.unavailable);
  });

  it('keeps the caller sentence for anything else', () => {
    expect(repositoryStartErrorMessage(new Error('boom'), 'generic')).toBe('generic');
    expect(repositoryStartErrorMessage(refused(418), 'generic')).toBe('generic');
  });
});

describe('archiveStartErrorMessage', () => {
  const messages = { generic: 'generic', tooLarge: 'too large' };

  it('reads a 413 as too large', () => {
    expect(archiveStartErrorMessage(refused(413), messages)).toBe('too large');
  });

  it('shows a fixed sentence by status, never the server or axios text', () => {
    expect(archiveStartErrorMessage(refused(400, ['file must be a zip']), messages)).toBe(en.errors.api.badRequest);
    expect(archiveStartErrorMessage({ message: 'Network Error', request: {} }, messages)).toBe(en.errors.api.unavailable);
    expect(archiveStartErrorMessage(new Error('boom'), messages)).toBe('generic');
  });
});
