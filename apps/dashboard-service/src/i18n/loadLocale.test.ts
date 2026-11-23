import { describe, expect, it } from 'vitest';
import { deepMerge, loadLocale } from './loadLocale';

describe('loadLocale', () => {
  it('derives keys from the path after /locales/<lang>/ for core and ee fragments alike', () => {
    const core = { './locales/en/components/a.json': { default: { x: 'core' } } };
    const ee = { '../ee/i18n/locales/en/components/a.json': { default: { y: 'ee' } } };
    expect(deepMerge(loadLocale(core, 'en'), loadLocale(ee, 'en'))).toEqual({
      components: { a: { x: 'core', y: 'ee' } },
    });
  });

  it('treats _self.json as its folder', () => {
    expect(loadLocale({ './locales/en/pages/b/_self.json': { default: { t: 1 } } }, 'en')).toEqual({
      pages: { b: { t: 1 } },
    });
  });
});
