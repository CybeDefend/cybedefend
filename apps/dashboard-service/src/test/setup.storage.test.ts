import { afterEach, describe, expect, it, vi } from 'vitest';

// Node 25 and later define their own `localStorage` and `sessionStorage` on
// the global object, which the jsdom environment then leaves in place. The
// test setup puts the jsdom window's storages back, so that the code under
// test and a spy on `Storage.prototype` see the same browser storage on every
// Node version.
describe('test setup: Web Storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it.each([
    ['localStorage', () => localStorage],
    ['sessionStorage', () => sessionStorage],
  ])('%s is a jsdom Storage, the same one as on window', (name, storage) => {
    expect(Object.getPrototypeOf(storage())).toBe(Storage.prototype);
    expect(storage()).toBe((window as unknown as Record<string, Storage>)[name]);
  });

  it.each([
    ['localStorage', () => localStorage],
    ['sessionStorage', () => sessionStorage],
  ])('a spy on Storage.prototype sees the calls made on %s', (_name, storage) => {
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    expect(() => storage().removeItem('key')).toThrow('The operation is insecure.');
    expect(removeItem).toHaveBeenCalledWith('key');
  });

  it.each([
    ['localStorage', () => localStorage],
    ['sessionStorage', () => sessionStorage],
  ])('%s keeps what is written and lists its keys', (_name, storage) => {
    storage().setItem('a', '1');

    expect(storage().getItem('a')).toBe('1');
    expect(Object.keys(storage())).toEqual(['a']);
  });
});
