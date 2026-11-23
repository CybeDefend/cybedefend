import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readInviteEmail } from './invite-email';

beforeEach(() => {
  sessionStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('invite-email-capture', () => {
  it('captures the invited address and wipes it from the address bar when imported', async () => {
    window.history.pushState({}, '', '/invite/tok-1?organizationName=Acme&email=ada%40example.test');
    vi.resetModules();

    await import('./invite-email-capture');

    expect(readInviteEmail('tok-1')).toBe('ada@example.test');
    expect(window.location.search).toBe('?organizationName=Acme');
  });

  // The edition's trackers load inside index.tsx's boot hooks, after every
  // static import: they record the page URL, so the address must be gone
  // before any of them runs, whatever their internals do.
  it('is the first import of index.tsx, ahead of every module that loads a tracker', () => {
    const source = readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
    const firstImport = /^import\s[^;]*;/m.exec(source)?.[0];
    expect(firstImport).toBe("import './lib/invite-email-capture';");
  });
});
