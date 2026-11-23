import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { roleLabelKey } from './roleLabel';

/**
 * The organisation role, as the shell prints it under the organisation's name
 * (rail) and in the account menu: a closed list of keys of `roles.*`, so an
 * unknown role prints nothing rather than a raw key.
 */
const en = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../i18n/locales/en/roles.json'), 'utf8'),
) as { roles: Record<string, unknown> };

describe('roleLabelKey', () => {
  it.each([
    ['creator', 'roles.creator'],
    ['administrator', 'roles.administrator'],
    ['manager', 'roles.manager'],
    ['member', 'roles.member'],
    ['billing_manager', 'roles.billingManager'],
  ])('names %s with %s, a key that exists', (role, key) => {
    expect(roleLabelKey(role)).toBe(key);
    expect(typeof en.roles[key.split('.')[1]]).toBe('string');
  });

  it.each([undefined, null, '', 'owner', 'explanations'])('names nothing for %s', (role) => {
    expect(roleLabelKey(role)).toBeNull();
  });
});
