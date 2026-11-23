import { describe, expect, it } from 'vitest';
import { SENSITIVE_ATTRIBUTE, sensitive } from './sensitive';

/**
 * Core components mark what they render on the customer's behalf with one
 * neutral attribute. The marker carries no behaviour of its own: whatever
 * observes the page decides what to do with it.
 */
describe('sensitive()', () => {
  it('sets the neutral data attribute to the kind of content', () => {
    expect(SENSITIVE_ATTRIBUTE).toBe('data-sensitive');
    expect(sensitive('secret')).toEqual({ 'data-sensitive': 'secret' });
    expect(sensitive('content')).toEqual({ 'data-sensitive': 'content' });
  });
});
