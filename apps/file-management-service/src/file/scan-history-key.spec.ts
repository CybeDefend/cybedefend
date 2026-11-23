import { historyKeyForArchive, historyObjectKey } from './scan-history-key';

describe('scan history key', () => {
  it('builds the history key next to the archive', () => {
    expect(historyObjectKey('p', 's')).toBe('scan/p/s.history.tar');
  });

  it('derives the history key from the archive key', () => {
    expect(historyKeyForArchive('scan/p/s.zip')).toBe('scan/p/s.history.tar');
  });

  it.each([
    'reports/p/r.pdf',
    'scan/p/s.filtered.zip',
    'scan/p/a/b.zip',
    '',
    'scan/p/s.tar',
  ])('returns null for %p', (key) => {
    expect(historyKeyForArchive(key)).toBeNull();
  });
});
