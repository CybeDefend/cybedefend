import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A finding's description comes from a scanner or an imported report: text nobody here wrote. The
 * finding pages render it through `SafeMarkdown`, which drops images (a remote image tells its
 * host who opened the finding, and when) and opens only safe links, in a new tab. A plain
 * `react-markdown` would render both.
 */
describe('the finding pages render descriptions with SafeMarkdown', () => {
  it.each(['IssueSastIacTemplate.tsx', 'IssueScaTemplate.tsx', 'IssueContainerTemplate.tsx'])('%s', (file) => {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    expect(source).not.toMatch(/from ['"]react-markdown['"]/);
    expect(source).toMatch(/<SafeMarkdown\b/);
  });
});
