import { describe, expect, it } from 'vitest';

import { jiraProjectLabel } from './jiraProjectLabel';

/**
 * How a Jira project is named in the Issues settings: the
 * name first, its key after it in brackets, « Security (SEC) », never
 * « SEC - Security »: no separator glyph between the two.
 */
describe('jiraProjectLabel', () => {
  it('names the project, then its key in brackets', () => {
    expect(jiraProjectLabel('SEC', 'Security')).toBe('Security (SEC)');
  });

  it('never puts a dash between the key and the name', () => {
    expect(jiraProjectLabel('PROJ', 'Project One')).not.toMatch(/\s[-–—]\s/);
  });

  it('falls back to whichever of the two is known', () => {
    expect(jiraProjectLabel('SEC', '')).toBe('SEC');
    expect(jiraProjectLabel('', 'Security')).toBe('Security');
    expect(jiraProjectLabel(undefined, undefined)).toBe('');
  });

  it('does not repeat a key that is also the name', () => {
    expect(jiraProjectLabel('SEC', 'SEC')).toBe('SEC');
  });
});
