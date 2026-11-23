import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Some components render what belongs to the customer and must never leave
 * the browser through anything that observes the page: a secret or a
 * credential shown once (`sensitive('secret')`), or the customer's source code
 * (`sensitive('content')`). The marker is a neutral attribute
 * (`utils/privacy/sensitive.ts`); this guard keeps it on the components that
 * need it, so a refactor that drops it fails here instead of silently.
 *
 * A new component that shows a secret, a credential or customer code adds its
 * marker and its line below.
 */
const ROOT = path.resolve(__dirname, '../../../..');

const MARKED: { file: string; kind: 'secret' | 'content'; atLeast: number; why: string }[] = [
  { file: 'src/components/molecules/issue/secret-reveal-card/SecretRevealCard.tsx', kind: 'secret', atLeast: 1, why: 'a revealed secret of the customer' },
  { file: 'src/pages/profile-pages/pat-page/DisplayPatModal.tsx', kind: 'secret', atLeast: 1, why: 'a personal access token, shown once' },
  { file: 'src/components/molecules/modal/invite-member-organization-modal/InvitationLinkNotice.tsx', kind: 'secret', atLeast: 1, why: 'an invitation link, which carries its token' },
  { file: 'src/components/molecules/issue/code-snippet/CodeSnippet.tsx', kind: 'content', atLeast: 1, why: "a finding's source code" },
  { file: 'src/components/molecules/issue/code-snippet/CodeSnippetDataFlow.tsx', kind: 'content', atLeast: 1, why: "a data-flow step's source code" },
];

const occurrences = (text: string, kind: string): number =>
  text.split(`sensitive('${kind}')`).length - 1;

describe('sensitive markers', () => {
  it.each(MARKED)('$file keeps its $kind marker ($why)', ({ file, kind, atLeast }) => {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    expect(occurrences(text, kind)).toBeGreaterThanOrEqual(atLeast);
  });

  it('the helper still writes the neutral attribute', () => {
    const text = fs.readFileSync(path.join(ROOT, 'src/utils/privacy/sensitive.ts'), 'utf8');
    expect(text).toContain("'data-sensitive'");
  });
});
