import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { COMMUNITY_SUPPORT_URL, SECURITY_POLICY_URL, supportUrl } from './support';

/**
 * Where « Contact support » goes. A self-hosted instance has no service desk: the Community
 * Edition sends its users to the public project's issues (and security reports to its security
 * policy). An edition that runs a desk names it through its extensions (`supportUrl`), so the
 * core names no hosted address.
 */
describe('supportUrl', () => {
  it('sends the Community Edition to the public project\'s issues', () => {
    expect(COMMUNITY_SUPPORT_URL).toBe('https://github.com/CybeDefend/cybedefend/issues');
    expect(supportUrl('community')).toBe(COMMUNITY_SUPPORT_URL);
  });

  it('names the public project\'s security policy for vulnerability reports', () => {
    expect(SECURITY_POLICY_URL).toBe('https://github.com/CybeDefend/cybedefend/security/policy');
  });

  it('names no hosted service desk in the core', () => {
    for (const file of ['support.ts', '../utils/constants/support.ts']) {
      const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
      expect(source, file).not.toMatch(/atlassian|servicedesk|support@/i);
    }
  });
});
