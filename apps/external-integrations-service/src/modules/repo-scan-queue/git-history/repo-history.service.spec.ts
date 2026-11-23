jest.mock('../../../core/utils/signed-url-upload', () => ({
  ...jest.requireActual<typeof import('../../../core/utils/signed-url-upload')>(
    '../../../core/utils/signed-url-upload',
  ),
  uploadFileToSignedUrl: jest.fn(),
}));

import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { of, throwError } from 'rxjs';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createFixtureRepo,
  FixtureRepo,
  gitAt,
  hasObject,
  pseudoRandomBytes,
} from '../../../core/utils/git-history/__fixtures__/fixture-repo';
import * as fetchModule from '../../../core/utils/git-history/fetch-branch-history';
import {
  GIT_HISTORY_BUDGET_ENV,
  GIT_HISTORY_DEADLINE_ENV,
} from '../../../core/utils/git-history/history-budget';
import { uploadFileToSignedUrl } from '../../../core/utils/signed-url-upload';
import { createLoggerMock } from '../../../test-utils/mocks';
import { PreparedHistory, RepoHistoryService } from './repo-history.service';

/**
 * Real git against `file://` fixtures; only the gRPC clients and the PUT to
 * the signed URL are doubles.
 */

const mockUpload = uploadFileToSignedUrl as jest.MockedFunction<
  typeof uploadFileToSignedUrl
>;

const savedEnv = {
  GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  [GIT_HISTORY_BUDGET_ENV]: process.env[GIT_HISTORY_BUDGET_ENV],
  [GIT_HISTORY_DEADLINE_ENV]: process.env[GIT_HISTORY_DEADLINE_ENV],
};

function restoreEnv(name: keyof typeof savedEnv): void {
  const value = savedEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeAll(() => {
  // The code under test runs git with this process's environment.
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_CONFIG_GLOBAL = os.devNull;
});

afterAll(() => {
  restoreEnv('GIT_CONFIG_NOSYSTEM');
  restoreEnv('GIT_CONFIG_GLOBAL');
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  jest.restoreAllMocks();
  restoreEnv(GIT_HISTORY_BUDGET_ENV);
  restoreEnv(GIT_HISTORY_DEADLINE_ENV);
  while (cleanups.length > 0) cleanups.pop()?.();
});

function track(repo: FixtureRepo): FixtureRepo {
  cleanups.push(() => repo.cleanup());
  return repo;
}

/** Removes what a prepared history left on disk, if a test failed before cleanup. */
function trackPrepared(prepared: PreparedHistory): PreparedHistory {
  cleanups.push(() => {
    const leftover =
      prepared.mode === 'in_archive' ? prepared.gitDir : prepared.tarPath;
    // Only what this service created (`git-history-*`): never a parent such
    // as the OS temp directory itself.
    for (const target of leftover ? [leftover, path.dirname(leftover)] : []) {
      if (path.basename(target).startsWith('git-history-')) {
        fs.rmSync(target, { recursive: true, force: true });
      } else if (target === leftover) {
        fs.rmSync(target, { force: true });
      }
    }
  });
  return prepared;
}

const SCAN = { scanId: 'scan-1', projectId: 'project-1', typeScan: 'sast' };
const SIGNED_URL =
  'https://storage.example/bucket/scan/project-1/scan-1.history.tar?sig=abc';

async function build(cursor: { mode: string; tipSha?: string }): Promise<{
  service: RepoHistoryService;
  scanClient: {
    getGitHistoryCursor: jest.Mock;
    recordGitHistoryPass: jest.Mock;
  };
  fileClient: { uploadFile: jest.Mock };
  logger: ReturnType<typeof createLoggerMock>;
}> {
  const scanClient = {
    getGitHistoryCursor: jest.fn(() => of(cursor)),
    recordGitHistoryPass: jest.fn(() => of({ success: true })),
  };
  const fileClient = {
    uploadFile: jest.fn(() => of({ url: SIGNED_URL, scanId: SCAN.scanId })),
  };
  const logger = createLoggerMock();
  const module = await Test.createTestingModule({
    providers: [
      RepoHistoryService,
      {
        provide: 'SECURITY_SCANNING_SERVICE',
        useValue: { getService: jest.fn(() => scanClient) },
      },
      {
        provide: 'FILE_MANAGEMENT_SERVICE',
        useValue: { getService: jest.fn(() => fileClient) },
      },
      { provide: Logger, useValue: logger },
    ],
  }).compile();
  const service = module.get(RepoHistoryService);
  service.onModuleInit();
  return { service, scanClient, fileClient, logger };
}

function params(repo: { url: string } | null) {
  return {
    scanId: SCAN.scanId,
    projectId: SCAN.projectId,
    branch: 'main',
    repositoryKey: 'github:acme/app',
    cloneUrl: repo ? repo.url : null,
  };
}

/** A clone URL nothing answers: every git call on it fails. */
function deadUrl(): { url: string } {
  return {
    url: pathToFileURL(path.join(os.tmpdir(), 'no-such-repository.git')).href,
  };
}

beforeEach(() => {
  mockUpload.mockReset();
  mockUpload.mockResolvedValue(undefined);
});

describe('RepoHistoryService', () => {
  it('in_archive mode returns a bounded gitDir and never records a pass', async () => {
    const old = pseudoRandomBytes(256 * 1024, 'old-vendored-binary');
    const commits: Array<Record<string, string | Buffer>> = [
      { 'vendor.bin': old, 'n.txt': '0' },
    ];
    for (let i = 1; i <= 60; i += 1) commits.push({ 'n.txt': String(i) });
    const repo = track(createFixtureRepo(commits));
    process.env[GIT_HISTORY_BUDGET_ENV] = String(old.length / 2);
    const { service, scanClient, fileClient } = await build({
      mode: 'in_archive',
    });

    const prepared = trackPrepared(await service.prepare(params(repo)));

    expect(scanClient.getGitHistoryCursor).toHaveBeenCalledWith({
      projectId: SCAN.projectId,
      branch: 'main',
      repositoryKey: 'github:acme/app',
    });
    expect(prepared.mode).toBe('in_archive');
    const gitDir = (prepared as { gitDir: string | null }).gitDir as string;
    expect(gitDir).toEqual(expect.any(String));
    expect(gitAt(gitDir, 'rev-parse', 'refs/heads/main')).toBe(repo.shas[60]);
    // Bounded: the old vendored blob is out of the budget, so its commit is not here.
    expect(gitAt(gitDir, 'rev-parse', '--is-shallow-repository')).toBe('true');
    expect(hasObject(gitDir, repo.shas[0])).toBe(false);

    await service.publish(prepared, SCAN);

    expect(fileClient.uploadFile).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(scanClient.recordGitHistoryPass).not.toHaveBeenCalled();

    service.cleanup(prepared);
    expect(fs.existsSync(gitDir)).toBe(false);
  });

  it('in_archive mode puts no .git in the archive when the tip alone exceeds the budget', async () => {
    const vendored = pseudoRandomBytes(256 * 1024, 'tip-vendored-binary');
    const repo = track(
      createFixtureRepo([
        { 'a.txt': 'a' },
        { 'a.txt': 'a', 'vendor.bin': vendored },
      ]),
    );
    process.env[GIT_HISTORY_BUDGET_ENV] = String(vendored.length / 2);
    const { service } = await build({ mode: 'in_archive' });

    const prepared = trackPrepared(await service.prepare(params(repo)));

    // An empty repository in the zip would make the secret scanner read no
    // history AND no file: better no .git at all.
    expect(prepared).toEqual({ mode: 'in_archive', gitDir: null });
  });

  it('incremental mode uploads the history tar then records the pass', async () => {
    const repo = track(
      createFixtureRepo([{ 'a.txt': '0' }, { 'a.txt': '1' }, { 'a.txt': '2' }]),
    );
    const { service, scanClient, fileClient } = await build({
      mode: 'incremental_artifact',
    });
    let tarAtUpload: { exists: boolean; size: number } | null = null;
    mockUpload.mockImplementation(async (_url, file) => {
      tarAtUpload = {
        exists: fs.existsSync(file),
        size: fs.existsSync(file) ? fs.statSync(file).size : 0,
      };
    });

    const prepared = trackPrepared(await service.prepare(params(repo)));

    expect(prepared.mode).toBe('incremental_artifact');
    const { tarPath, pass } = prepared as Extract<
      PreparedHistory,
      { mode: 'incremental_artifact' }
    >;
    expect(tarPath).toEqual(expect.any(String));
    expect(fs.existsSync(tarPath as string)).toBe(true);
    // The tar sits alone in a private directory of its own (no path another
    // local user could guess and pre-create): the repository is gone as soon
    // as its tar is written.
    const tarDir = path.dirname(tarPath as string);
    expect(fs.readdirSync(tarDir)).toEqual([path.basename(tarPath as string)]);
    expect(fs.statSync(tarDir).mode & 0o077).toBe(0);
    expect(pass).toEqual({
      mode: 'full',
      tipSha: repo.shas[2],
      excludeShas: [],
      oldestCommitAt: expect.any(String),
      bytes: expect.stringMatching(/^[1-9]\d*$/),
      firstPass: true,
      repositoryKey: 'github:acme/app',
    });

    await service.publish(prepared, SCAN);

    expect(fileClient.uploadFile).toHaveBeenCalledWith({
      scanId: SCAN.scanId,
      projectId: SCAN.projectId,
      typeScan: SCAN.typeScan,
      artifact: 'history',
    });
    expect(mockUpload).toHaveBeenCalledWith(SIGNED_URL, tarPath, {
      'Content-Type': 'application/x-tar',
    });
    expect(tarAtUpload).toEqual({ exists: true, size: expect.any(Number) });
    expect(tarAtUpload?.size).toBeGreaterThan(0);
    expect(scanClient.recordGitHistoryPass).toHaveBeenCalledWith({
      scanId: SCAN.scanId,
      pass,
    });
    // Signed right before its upload (the URL lives 10 s), recorded after it.
    expect(fileClient.uploadFile.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpload.mock.invocationCallOrder[0],
    );
    expect(mockUpload.mock.invocationCallOrder[0]).toBeLessThan(
      scanClient.recordGitHistoryPass.mock.invocationCallOrder[0],
    );

    service.cleanup(prepared);
    expect(fs.existsSync(tarDir)).toBe(false);
  });

  it('passes the cursor tip as previousTipSha', async () => {
    const repo = track(
      createFixtureRepo([
        { 'a.txt': '0' },
        { 'a.txt': '1' },
        { 'a.txt': '2' },
        { 'a.txt': '3' },
      ]),
    );
    const { service } = await build({
      mode: 'incremental_artifact',
      tipSha: repo.shas[1],
    });

    const prepared = trackPrepared(await service.prepare(params(repo)));

    expect(prepared).toEqual({
      mode: 'incremental_artifact',
      tarPath: expect.any(String),
      pass: {
        mode: 'incremental',
        tipSha: repo.shas[3],
        baseTipSha: repo.shas[1],
        excludeShas: [repo.shas[1]],
        oldestCommitAt: expect.any(String),
        bytes: expect.stringMatching(/^[1-9]\d*$/),
        firstPass: false,
        repositoryKey: 'github:acme/app',
      },
    });
  });

  it('a history failure records mode none and never throws', async () => {
    const previousTip = 'a'.repeat(40);
    const { service, scanClient, fileClient, logger } = await build({
      mode: 'incremental_artifact',
      tipSha: previousTip,
    });

    const prepared = trackPrepared(await service.prepare(params(deadUrl())));

    expect(prepared).toEqual({
      mode: 'incremental_artifact',
      tarPath: null,
      pass: {
        mode: 'none',
        baseTipSha: previousTip,
        excludeShas: [],
        bytes: '0',
        firstPass: false,
        repositoryKey: 'github:acme/app',
      },
    });
    expect(logger.warn).toHaveBeenCalled();

    await expect(service.publish(prepared, SCAN)).resolves.toBeUndefined();

    expect(fileClient.uploadFile).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    // Recorded all the same, so the coverage notice can say so.
    expect(scanClient.recordGitHistoryPass).toHaveBeenCalledWith({
      scanId: SCAN.scanId,
      pass: (prepared as { pass: unknown }).pass,
    });
  });

  it('a history the provider gave no credentials for records mode none', async () => {
    const { service, scanClient } = await build({
      mode: 'incremental_artifact',
    });

    const prepared = await service.prepare(params(null));
    await service.publish(prepared, SCAN);

    expect(prepared).toEqual({
      mode: 'incremental_artifact',
      tarPath: null,
      pass: {
        mode: 'none',
        excludeShas: [],
        bytes: '0',
        firstPass: true,
        repositoryKey: 'github:acme/app',
      },
    });
    expect(scanClient.recordGitHistoryPass).toHaveBeenCalledTimes(1);
  });

  it('a failed history upload records mode none', async () => {
    const repo = track(createFixtureRepo([{ 'a.txt': '0' }, { 'a.txt': '1' }]));
    const { service, scanClient, logger } = await build({
      mode: 'incremental_artifact',
    });
    mockUpload.mockRejectedValue(new Error('Request failed with status 403'));

    const prepared = trackPrepared(await service.prepare(params(repo)));
    await expect(service.publish(prepared, SCAN)).resolves.toBeUndefined();

    expect(scanClient.recordGitHistoryPass).toHaveBeenCalledWith({
      scanId: SCAN.scanId,
      pass: {
        mode: 'none',
        tipSha: repo.shas[1],
        excludeShas: [],
        bytes: '0',
        firstPass: true,
        repositoryKey: 'github:acme/app',
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('status 403'),
    );
  });

  it('never uploads the history to a signed URL that is not a history tar, and records mode none', async () => {
    // A file-management that does not know the artifact kind signs the
    // archive's key: the PUT would overwrite the scan's archive.
    const repo = track(createFixtureRepo([{ 'a.txt': '0' }, { 'a.txt': '1' }]));
    const { service, scanClient, fileClient, logger } = await build({
      mode: 'incremental_artifact',
    });
    const archiveUrl =
      'https://storage.example/bucket/scan/project-1/scan-1.zip?sig=secret-signature';
    fileClient.uploadFile.mockReturnValue(
      of({ url: archiveUrl, scanId: SCAN.scanId }),
    );

    const prepared = trackPrepared(await service.prepare(params(repo)));
    await expect(service.publish(prepared, SCAN)).resolves.toBeUndefined();

    expect(mockUpload).not.toHaveBeenCalled();
    expect(scanClient.recordGitHistoryPass).toHaveBeenCalledWith({
      scanId: SCAN.scanId,
      pass: {
        mode: 'none',
        tipSha: repo.shas[1],
        excludeShas: [],
        bytes: '0',
        firstPass: true,
        repositoryKey: 'github:acme/app',
      },
    });
    expect(logger.warn).toHaveBeenCalled();
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain(
      'secret-signature',
    );
  });

  it('records the committer dates of a gap', async () => {
    const vendored = pseudoRandomBytes(256 * 1024, 'repo-history-gap-dates');
    const repo = track(
      createFixtureRepo([
        { 'a.txt': '0' },
        { 'a.txt': '1' },
        { 'a.txt': '2' },
        { 'a.txt': '3', 'vendor.bin': vendored },
        { 'a.txt': '4' },
        { 'a.txt': '5' },
      ]),
    );
    process.env[GIT_HISTORY_BUDGET_ENV] = String(vendored.length / 2);
    const { service } = await build({
      mode: 'incremental_artifact',
      tipSha: repo.shas[2],
    });

    const prepared = trackPrepared(await service.prepare(params(repo)));

    const { pass } = prepared as Extract<
      PreparedHistory,
      { mode: 'incremental_artifact' }
    >;
    expect(pass.mode).toBe('incremental_with_gap');
    expect(pass.gap).toEqual({
      fromSha: repo.shas[2],
      toSha: repo.shas[5],
      fromDate: expect.any(String),
      toDate: expect.any(String),
    });
    expect(new Date(pass.gap?.fromDate as string).getTime()).toBeLessThan(
      new Date(pass.gap?.toDate as string).getTime(),
    );
  });

  it('recordGitHistoryPass is retried once', async () => {
    const repo = track(createFixtureRepo([{ 'a.txt': '0' }]));
    const { service, scanClient, logger } = await build({
      mode: 'incremental_artifact',
    });
    scanClient.recordGitHistoryPass.mockReturnValueOnce(
      throwError(() => new Error('14 UNAVAILABLE: connection reset')),
    );

    const prepared = trackPrepared(await service.prepare(params(repo)));
    await service.publish(prepared, SCAN);

    expect(scanClient.recordGitHistoryPass).toHaveBeenCalledTimes(2);
    expect(scanClient.recordGitHistoryPass.mock.calls[1]).toEqual(
      scanClient.recordGitHistoryPass.mock.calls[0],
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('could not be recorded'),
    );
  });

  it('a pass that cannot be recorded never fails the scan', async () => {
    const repo = track(createFixtureRepo([{ 'a.txt': '0' }]));
    const { service, scanClient, logger } = await build({
      mode: 'incremental_artifact',
    });
    scanClient.recordGitHistoryPass.mockReturnValue(
      throwError(() => new Error('14 UNAVAILABLE: connection refused')),
    );

    const prepared = trackPrepared(await service.prepare(params(repo)));

    await expect(service.publish(prepared, SCAN)).resolves.toBeUndefined();
    expect(scanClient.recordGitHistoryPass).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be recorded'),
    );
  });

  it('an in_archive history failure leaves the archive without .git', async () => {
    const { service, logger } = await build({ mode: 'in_archive' });

    const prepared = await service.prepare(params(deadUrl()));

    expect(prepared).toEqual({ mode: 'in_archive', gitDir: null });
    expect(logger.warn).toHaveBeenCalled();
  });

  /** The pass recorded when nothing is known about the history. */
  const unknownHistory: PreparedHistory = {
    mode: 'incremental_artifact',
    tarPath: null,
    pass: {
      mode: 'none',
      excludeShas: [],
      bytes: '0',
      firstPass: true,
      repositoryKey: 'github:acme/app',
    },
  };

  it('a cursor that cannot be read records mode none', async () => {
    const repo = track(createFixtureRepo([{ 'a.txt': '0' }]));
    const { service, scanClient, logger } = await build({
      mode: 'incremental_artifact',
    });
    scanClient.getGitHistoryCursor.mockReturnValue(
      throwError(() => new Error('14 UNAVAILABLE: connection refused')),
    );

    const prepared = await service.prepare(params(repo));
    await service.publish(prepared, SCAN);

    // Without a recorded pass, finalize would read the scan as one without
    // history and resolve the secrets found only in history.
    expect(prepared).toEqual(unknownHistory);
    expect(scanClient.recordGitHistoryPass).toHaveBeenCalledTimes(1);
    expect(scanClient.recordGitHistoryPass).toHaveBeenCalledWith({
      scanId: SCAN.scanId,
      pass: unknownHistory.pass,
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('an unknown history mode records mode none', async () => {
    const repo = track(createFixtureRepo([{ 'a.txt': '0' }]));
    const { service, scanClient } = await build({ mode: 'in_the_cloud' });

    const prepared = await service.prepare(params(repo));
    await service.publish(prepared, SCAN);

    expect(prepared).toEqual(unknownHistory);
    expect(scanClient.recordGitHistoryPass).toHaveBeenCalledTimes(1);
  });

  it('prepare never rejects, even on an unexpected error', async () => {
    const repo = track(createFixtureRepo([{ 'a.txt': '0' }]));
    const { service } = await build({ mode: 'incremental_artifact' });
    jest
      .spyOn(service as never, 'prepareArtifact')
      .mockRejectedValue(new Error('unexpected') as never);

    await expect(service.prepare(params(repo))).resolves.toEqual(
      unknownHistory,
    );
  });

  it.each(['in_archive', 'incremental_artifact'])(
    'bounds the %s fetch by GIT_HISTORY_DEADLINE_MS',
    async (mode) => {
      const repo = track(createFixtureRepo([{ 'a.txt': '0' }]));
      process.env[GIT_HISTORY_DEADLINE_ENV] = '60000';
      const { service } = await build({ mode });
      const fetchSpy = jest.spyOn(fetchModule, 'fetchBranchHistory');

      const before = Date.now();
      trackPrepared(await service.prepare(params(repo)));
      const after = Date.now();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const { deadlineAt } = fetchSpy.mock.calls[0][0];
      expect(deadlineAt).toBeGreaterThanOrEqual(before + 60_000);
      expect(deadlineAt).toBeLessThanOrEqual(after + 60_000);
    },
  );

  it('cleanup never removes a directory it did not create', async () => {
    const { service } = await build({ mode: 'in_archive' });
    const foreign = fs.mkdtempSync(
      path.join(os.tmpdir(), 'repo-history-spec-'),
    );
    cleanups.push(() => fs.rmSync(foreign, { recursive: true, force: true }));
    fs.writeFileSync(path.join(foreign, 'history.tar'), 'tar');

    service.cleanup({ mode: 'in_archive', gitDir: foreign });
    service.cleanup({
      mode: 'incremental_artifact',
      tarPath: path.join(foreign, 'history.tar'),
      pass: {
        mode: 'full',
        excludeShas: [],
        bytes: '3',
        firstPass: true,
        repositoryKey: 'github:acme/app',
      },
    });

    expect(fs.readdirSync(foreign)).toEqual(['history.tar']);

    // A `git-history-*` name alone is not enough: only a directory directly
    // under the OS temp dir, where this service creates them, is removed.
    const lookalike = path.join(foreign, 'git-history-lookalike');
    fs.mkdirSync(lookalike);
    service.cleanup({ mode: 'in_archive', gitDir: lookalike });
    expect(fs.existsSync(lookalike)).toBe(true);
  });

  it('cleanup of a history without files is a no-op', async () => {
    const { service } = await build({ mode: 'in_archive' });

    expect(() =>
      service.cleanup({ mode: 'in_archive', gitDir: null }),
    ).not.toThrow();
    expect(() =>
      service.cleanup({
        mode: 'incremental_artifact',
        tarPath: null,
        pass: {
          mode: 'none',
          excludeShas: [],
          bytes: '0',
          firstPass: true,
          repositoryKey: 'github:acme/app',
        },
      }),
    ).not.toThrow();
  });
});
