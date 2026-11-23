import { describe, it, expect } from 'vitest';
import { isStartOut } from './analyseWrapperLogic';

// The start modal cases are tested in the closed tree: the modal is rendered
// only in the cloud.
describe('isStartOut', () => {
  it('is the placeholder scan of an accepted start, and nothing else', () => {
    expect(isStartOut(null)).toBe(false);
    expect(isStartOut({ id: '', state: 'initializing' })).toBe(true);
    expect(isStartOut({ id: '', state: 'failed' })).toBe(false);
    // A real scan has an id, whatever its state.
    expect(isStartOut({ id: 'scan-1', state: 'initializing' })).toBe(false);
    expect(isStartOut({ id: 'scan-1', state: 'running' })).toBe(false);
  });
});
