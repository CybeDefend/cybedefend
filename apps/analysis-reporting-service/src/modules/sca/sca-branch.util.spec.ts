/**
 * Unit tests for the SCA "effective branch" resolution.
 *
 * The empty-string partition ('') — produced by no-branch scans (getScan
 * returns '') and the legacy `branch` column default — is the SAME logical
 * branch as the project's canonical scoring/default branch. A real feature
 * branch (not among the scoring branches) must stay its own partition so
 * genuine multi-branch SCA never cross-resolves.
 */
import { Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { of, throwError } from 'rxjs';
import { ProjectInformationsResponse } from '@grpc/global-management/project';

import {
  lookupProjectWithScaBranches,
  resolveScaEffectiveBranches,
  scaEffectiveBranchesFromLookup,
} from './sca-branch.util';

describe('resolveScaEffectiveBranches', () => {
  it('collapses an empty branch into the canonical scoring branches plus the empty partition', () => {
    expect(resolveScaEffectiveBranches(['main', 'master'], '')).toEqual([
      'main',
      'master',
      '',
    ]);
  });

  it('treats an absent (undefined) branch like the default partition', () => {
    expect(resolveScaEffectiveBranches(['main'], undefined)).toEqual([
      'main',
      '',
    ]);
  });

  it('treats null branch like the default partition', () => {
    expect(resolveScaEffectiveBranches(['main'], null)).toEqual(['main', '']);
  });

  it('folds the empty partition in when the requested branch IS the canonical branch', () => {
    expect(resolveScaEffectiveBranches(['main'], 'main')).toEqual(['main', '']);
  });

  it('folds ONLY the requested canonical branch + empty, not the other fallback scoring branches', () => {
    // A specific branch must not drag in the sibling fallback branch ('master'),
    // otherwise the resolver would cross-resolve a genuinely separate branch.
    expect(resolveScaEffectiveBranches(['main', 'master'], 'main')).toEqual([
      'main',
      '',
    ]);
  });

  it('scopes a real feature branch strictly to itself (no empty partition)', () => {
    expect(resolveScaEffectiveBranches(['main'], 'feature/x')).toEqual([
      'feature/x',
    ]);
  });

  it('trims whitespace on the requested branch before matching', () => {
    expect(resolveScaEffectiveBranches(['main'], '  main  ')).toEqual([
      'main',
      '',
    ]);
  });

  it('does not duplicate the empty partition when a scoring branch is already empty', () => {
    expect(resolveScaEffectiveBranches([''], '')).toEqual(['']);
  });

  it('falls back to just the empty partition when there are no scoring branches', () => {
    expect(resolveScaEffectiveBranches([], '')).toEqual(['']);
  });

  it('still scopes a feature branch strictly even with no scoring branches', () => {
    expect(resolveScaEffectiveBranches([], 'feature/x')).toEqual(['feature/x']);
  });
});

// A results list already reads its project; the partition comes
// from that lookup instead of a second ProjectService/Get.
describe('scaEffectiveBranchesFromLookup', () => {
  it('folds the legacy partition into the reference branch read from the project', async () => {
    await expect(
      scaEffectiveBranchesFromLookup(
        Promise.resolve({ referenceBranch: 'develop' }),
        '',
      ),
    ).resolves.toEqual(['develop', '']);
  });

  it('keeps a feature branch strictly to itself', async () => {
    await expect(
      scaEffectiveBranchesFromLookup(
        Promise.resolve({ referenceBranch: 'develop' }),
        'feature/x',
      ),
    ).resolves.toEqual(['feature/x']);
  });

  it('falls back to the main/master partition when the lookup fails', async () => {
    await expect(
      scaEffectiveBranchesFromLookup(Promise.reject(new Error('gm down'))),
    ).resolves.toEqual(['main', 'master', '']);
  });
});

// The single helper every results list (grouped, flat, SCA)
// goes through: one Get, and the SCA partition derived from it.
describe('lookupProjectWithScaBranches', () => {
  const answering = (project: Partial<ProjectInformationsResponse>) => ({
    get: jest.fn(() => of(project as ProjectInformationsResponse)),
  });

  it('reads the project once and derives the partition from that read', async () => {
    const project = { id: 'p1', name: 'Shop', referenceBranch: 'develop' };
    const client = answering(project);

    const { projectLookup, scaBranches } = lookupProjectWithScaBranches(
      client,
      'p1',
      '',
    );

    await expect(projectLookup).resolves.toBe(project);
    await expect(scaBranches).resolves.toEqual(['develop', '']);
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith({ projectId: 'p1' });
  });

  it('keeps a feature branch strictly to itself', async () => {
    const client = answering({ referenceBranch: 'develop' });

    const { scaBranches } = lookupProjectWithScaBranches(
      client,
      'p1',
      'feature/x',
    );

    await expect(scaBranches).resolves.toEqual(['feature/x']);
  });

  it('fails the lookup with the gRPC status, and falls back to main/master for the partition', async () => {
    const client = {
      get: jest.fn(() =>
        throwError(() => ({ code: status.UNAVAILABLE, details: 'gm down' })),
      ),
    };

    const { projectLookup, scaBranches } = lookupProjectWithScaBranches(
      client,
      'p1',
      undefined,
    );

    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    try {
      await expect(scaBranches).resolves.toEqual(['main', 'master', '']);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('projectId=p1'),
      );
    } finally {
      warn.mockRestore();
    }
    const failure = await projectLookup.catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(RpcException);
    expect((failure as RpcException).getError()).toEqual({
      code: status.UNAVAILABLE,
      message: 'gm down',
    });
  });
});
