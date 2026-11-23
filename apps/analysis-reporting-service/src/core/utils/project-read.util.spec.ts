import { of, throwError } from 'rxjs';
import { readArchivedBranches } from './project-read.util';

describe('readArchivedBranches', () => {
  it('returns the names of the branches archived in the project', async () => {
    const getArchivedBranches = jest.fn(() =>
      of({ branches: ['release/1.0', 'old-feature'] }),
    );

    const read = await readArchivedBranches(
      { getArchivedBranches },
      'project-1',
    );

    expect(getArchivedBranches).toHaveBeenCalledWith({
      projectId: 'project-1',
    });
    expect(read.failure).toBeUndefined();
    expect([...read.branches].sort()).toEqual(['old-feature', 'release/1.0']);
  });

  it('returns an empty set for a project without archived branches', async () => {
    const read = await readArchivedBranches(
      { getArchivedBranches: () => of({ branches: [] }) },
      'project-1',
    );

    expect(read.branches.size).toBe(0);
  });

  it('says why global-management could not answer', async () => {
    const read = await readArchivedBranches(
      {
        getArchivedBranches: () =>
          throwError(
            () => new Error('7 PERMISSION_DENIED: caller not allowed'),
          ),
      },
      'project-1',
    );

    expect(read.branches).toBeNull();
    expect(read.failure).toBe('7 PERMISSION_DENIED: caller not allowed');
  });

  it('says so without a client', async () => {
    const read = await readArchivedBranches(null, 'project-1');

    expect(read.branches).toBeNull();
    expect(read.failure).toBe('no ProjectService client');
  });
});
