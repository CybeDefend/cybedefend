import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { Container } from 'src/entities/container.entity';
import type { Scan } from 'src/entities/scan.entity';
import type {
  ProjectScanSettings,
  StartScanRequest,
} from '@grpc/security-scanning/scan';
import { COMMUNITY_BINDINGS } from '../community-bindings';
import { AI_ANALYSIS_PORT } from '../ports/ai-analysis.port';
import { ENTITLEMENTS_PORT } from '../ports/entitlements.port';
import {
  SCANNERS_NOT_AVAILABLE,
  SCANNER_ORCHESTRATOR_PORT,
} from '../ports/scanner-orchestrator.port';
import { SCANNER_PODS_PORT } from '../ports/scanner-pods.port';
import { SCAN_LIFECYCLE_HOOKS } from '../ports/scan-lifecycle-hooks.port';
import { GIT_HISTORY_MODE_PORT } from '../ports/git-history-mode.port';
import { CommunityGitHistoryMode } from './git-history-mode.community';
import { CommunityAiAnalysis } from './ai-analysis.community';
import { CommunityEntitlements } from './entitlements.community';
import { CommunityScannerOrchestrator } from './scanner-orchestrator.community';
import { CommunityScannerPods } from './scanner-pods.community';
import { CommunityScanLifecycleHooks } from './scan-lifecycle-hooks.community';
import { SCANNER_CALL_BINDING } from '../ports/scanner-call-binding.port';
import { CommunityScannerCallBinding } from './scanner-call-binding.community';
import type { ClusterScannerOrchestrator } from '../../modules/cluster-scanning/cluster-scanner-orchestrator';
import type { ClusterScanningState } from '../../modules/cluster-scanning/cluster-scanning.state';
import type { CommunityKubeClient } from '../../modules/cluster-scanning/kube-client';
import {
  readClusterScanningConfig,
  type ClusterScanningConfig,
} from '../../modules/cluster-scanning/cluster-scanning.config';

const REFUSAL = {
  code: status.FAILED_PRECONDITION,
  message: SCANNERS_NOT_AVAILABLE,
};

const scan = { id: 'scan-1' } as Scan;
const container = { id: 'container-1' } as Container;
const startRequest: StartScanRequest = {
  scanId: 'scan-1',
  projectId: 'project-1',
  language: [],
};
const project = {} as ProjectScanSettings;

async function rejectionOf(promise: Promise<unknown>): Promise<RpcException> {
  const error: unknown = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RpcException);
  return error as RpcException;
}

describe('Community edition ports', () => {
  it('refuses every non-import CreateScan with SCANNERS_NOT_AVAILABLE', () => {
    const orchestrator = new CommunityScannerOrchestrator();
    const request = {
      scanId: 's',
      projectId: 'p',
      initializerUserId: 'u',
      privateScan: false,
      vulnerabilityTypes: [],
    };
    expect(() => orchestrator.assertScanSupported(request)).toThrow(
      RpcException,
    );
    let caught: unknown;
    try {
      orchestrator.assertScanSupported(request);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RpcException);
    expect((caught as RpcException).getError()).toEqual({
      code: status.FAILED_PRECONDITION,
      message: 'SCANNERS_NOT_AVAILABLE',
    });
  });

  // Without a running engine the refusal comes at CreateScan; the project
  // check has nothing to add.
  it('lets the project check through when no cluster engine runs', async () => {
    const orchestrator = new CommunityScannerOrchestrator();
    await expect(
      orchestrator.assertProjectScannable('project-1'),
    ).resolves.toBeUndefined();
  });

  it('hands the project check to the running cluster engine', async () => {
    const engine = {
      assertProjectScannable: jest.fn(async () => {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: 'NO_SCANNER_ENABLED',
        });
      }),
    };
    const orchestrator = new CommunityScannerOrchestrator(
      engine as unknown as ClusterScannerOrchestrator,
      { enabled: true } as unknown as ClusterScanningState,
    );
    const error = await rejectionOf(
      orchestrator.assertProjectScannable('project-1', 'sast'),
    );
    expect(error.getError()).toEqual({
      code: status.FAILED_PRECONDITION,
      message: 'NO_SCANNER_ENABLED',
    });
    expect(engine.assertProjectScannable).toHaveBeenCalledWith(
      'project-1',
      'sast',
    );
  });

  it('refuses saveNewScan and startScan the same way', async () => {
    const orchestrator = new CommunityScannerOrchestrator();
    const saveError = await rejectionOf(orchestrator.saveNewScan(scan));
    expect(saveError.getError()).toEqual(REFUSAL);
    const startError = await rejectionOf(
      orchestrator.startScan(scan, startRequest),
    );
    expect(startError.getError()).toEqual(REFUSAL);
  });

  it('releases no pod and deletes none', async () => {
    const pods = new CommunityScannerPods();
    await expect(
      pods.releaseTerminatedContainer(scan, container),
    ).resolves.toBeUndefined();
    await expect(pods.deleteScannerPodStrict('pod-1')).resolves.toBeUndefined();
    await expect(
      pods.deleteScannerPodStrict('pod-1', 'sast'),
    ).resolves.toBeUndefined();
  });

  it('creates no agent row and starts no analysis', async () => {
    const ai = new CommunityAiAnalysis();
    await expect(
      ai.triggerAgentIngestion(scan, 'file:///uploads/scan-1.zip', project),
    ).resolves.toBeUndefined();
    await expect(ai.runAgentAnalysisQueue()).resolves.toEqual({
      closed: 0,
      queued: 0,
      started: 0,
    });
    await expect(
      ai.closeAgentContainer('scan-1', 'container-1', {
        status: 'completed',
        outcomeReason: 'nothing_to_analyze',
        step: 'ai',
      }),
    ).resolves.toBe(false);
    const graphError = await rejectionOf(
      ai.startGraphOnlyScan(scan, startRequest),
    );
    expect(graphError.getError()).toEqual(REFUSAL);
  });

  it('runs no lifecycle hook work', () => {
    const hooks = new CommunityScanLifecycleHooks();
    expect(() =>
      hooks.onScanClosed({ id: 'scan-1' }, 'completed', 'scan_level'),
    ).not.toThrow();
    expect(() =>
      hooks.onScanClosed(
        {
          id: 'scan-1',
          organizationId: 'org-1',
          projectId: 'project-1',
          isDiffScan: 1,
          isGraphOnly: false,
        },
        'failed',
        'cancel',
      ),
    ).not.toThrow();
  });

  it('allows everything the Community Edition contains', async () => {
    const entitlements = new CommunityEntitlements();
    await expect(entitlements.isWritable('o')).resolves.toEqual({
      writable: true,
      trial: false,
    });
    await expect(entitlements.hasFeature('o', 'jira')).resolves.toBe(true);
  });

  it('binds GIT_HISTORY_MODE_PORT to its Community class', () => {
    expect(COMMUNITY_BINDINGS).toContainEqual({
      provide: GIT_HISTORY_MODE_PORT,
      useClass: CommunityGitHistoryMode,
    });
    expect(new CommunityGitHistoryMode().mode()).toBe('in_archive');
  });

  it('binds each port to its Community class', () => {
    expect(COMMUNITY_BINDINGS).toContainEqual({
      provide: SCANNER_ORCHESTRATOR_PORT,
      useClass: CommunityScannerOrchestrator,
    });
    expect(COMMUNITY_BINDINGS).toContainEqual({
      provide: SCANNER_PODS_PORT,
      useClass: CommunityScannerPods,
    });
    expect(COMMUNITY_BINDINGS).toContainEqual({
      provide: AI_ANALYSIS_PORT,
      useClass: CommunityAiAnalysis,
    });
    expect(COMMUNITY_BINDINGS).toContainEqual({
      provide: SCAN_LIFECYCLE_HOOKS,
      useClass: CommunityScanLifecycleHooks,
    });
    expect(COMMUNITY_BINDINGS).toContainEqual({
      provide: ENTITLEMENTS_PORT,
      useClass: CommunityEntitlements,
    });
    expect(COMMUNITY_BINDINGS).toContainEqual({
      provide: SCANNER_CALL_BINDING,
      useClass: CommunityScannerCallBinding,
    });
  });

  it('community binding refuses every scanner call', async () => {
    const binding = new CommunityScannerCallBinding();
    const identity = {
      pod: 'scan-pod-sast-1',
      podUid: 'uid-1',
      namespace: 'scanners-namespace',
      scanId: 'scan-1',
      projectId: 'project-1',
    };
    for (const method of [
      '/cybedefend.security_scanning.ScanService/GetScan',
      '/cybedefend.security_scanning.ScanService/UpdateScan',
      '/cybedefend.security_scanning.ScanService/UpdateScanData',
    ]) {
      await expect(
        binding.bind({
          method,
          identity,
          request: { scanId: 'scan-1', projectId: 'project-1' },
        }),
      ).resolves.toBe('not-bound');
    }
  });

  describe('the scanner orchestrator facade and the cluster engine', () => {
    const createRequest = {
      scanId: 's',
      projectId: 'p',
      initializerUserId: 'u',
      privateScan: false,
      vulnerabilityTypes: [],
    };
    const engine = () => ({
      assertScanSupported: jest.fn(),
      saveNewScan: jest.fn(async () => undefined),
      startScan: jest.fn(async () => ({
        success: true,
        message: 'Code scan started.',
        detectedLanguages: [],
      })),
    });
    const asEngine = (e: ReturnType<typeof engine>) =>
      e as unknown as ClusterScannerOrchestrator;
    const stateOf = (enabled: boolean) =>
      ({ enabled }) as unknown as ClusterScanningState;

    it.each([
      ['without the engine', undefined, undefined],
      ['while disabled', engine(), stateOf(false)],
    ])('%s: SCANNERS_NOT_AVAILABLE, as today', async (_label, e, state) => {
      const facade = new CommunityScannerOrchestrator(e && asEngine(e), state);
      let caught: unknown;
      try {
        facade.assertScanSupported(createRequest);
      } catch (error) {
        caught = error;
      }
      expect((caught as RpcException).getError()).toEqual(REFUSAL);
      expect((await rejectionOf(facade.saveNewScan(scan))).getError()).toEqual(
        REFUSAL,
      );
      expect(
        (await rejectionOf(facade.startScan(scan, startRequest))).getError(),
      ).toEqual(REFUSAL);
      if (e) {
        expect(e.assertScanSupported).not.toHaveBeenCalled();
        expect(e.saveNewScan).not.toHaveBeenCalled();
        expect(e.startScan).not.toHaveBeenCalled();
      }
    });

    it('enabled: delegates', async () => {
      const e = engine();
      const facade = new CommunityScannerOrchestrator(
        asEngine(e),
        stateOf(true),
      );
      facade.assertScanSupported(createRequest);
      expect(e.assertScanSupported).toHaveBeenCalledWith(createRequest);
      await facade.saveNewScan(scan);
      expect(e.saveNewScan).toHaveBeenCalledWith(scan);
      await expect(facade.startScan(scan, startRequest)).resolves.toMatchObject(
        { success: true },
      );
      expect(e.startScan).toHaveBeenCalledWith(scan, startRequest);
    });
  });

  describe('the scanner pods facade and the cluster engine', () => {
    const cfg = (keepPods = false): ClusterScanningConfig =>
      readClusterScanningConfig({
        CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/kubeconfig',
        CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
        FRONTEND_URL: 'https://appsec.example.com',
        CYBEDEFEND_SCANNER_KEEP_PODS: String(keepPods),
      });
    const kubeOf = () => ({
      deletePod: jest.fn(async () => undefined),
      deleteSecret: jest.fn(async () => undefined),
    });
    const asKube = (k: ReturnType<typeof kubeOf>) =>
      k as unknown as CommunityKubeClient;
    const enabled = { enabled: true } as unknown as ClusterScanningState;
    const clusterContainer = {
      id: 'c1',
      podName: 'cd-scan-opengrep-c1',
      image: 'cybedefend-scanners/opengrep:1.0.0',
    } as Container;

    it('releases the pod and its Secret of a closed cluster container', async () => {
      const kube = kubeOf();
      const pods = new CommunityScannerPods(enabled, asKube(kube), cfg());
      await pods.releaseTerminatedContainer(scan, clusterContainer);
      expect(kube.deletePod).toHaveBeenCalledWith('cd-scan-opengrep-c1');
      expect(kube.deleteSecret).toHaveBeenCalledWith('cd-scan-opengrep-c1-run');
    });

    it('a release never rejects: the sweep retries', async () => {
      const kube = kubeOf();
      kube.deletePod.mockRejectedValueOnce(
        new Error('deletePod failed status=500'),
      );
      const pods = new CommunityScannerPods(enabled, asKube(kube), cfg());
      await expect(
        pods.releaseTerminatedContainer(scan, clusterContainer),
      ).resolves.toBeUndefined();
    });

    it('keepPods keeps the pod at release, purge still deletes it', async () => {
      const kube = kubeOf();
      const pods = new CommunityScannerPods(enabled, asKube(kube), cfg(true));
      await pods.releaseTerminatedContainer(scan, clusterContainer);
      expect(kube.deletePod).not.toHaveBeenCalled();
      expect(kube.deleteSecret).not.toHaveBeenCalled();
      await pods.deleteScannerPodStrict('cd-scan-opengrep-c1', 'sast');
      expect(kube.deletePod).toHaveBeenCalledWith('cd-scan-opengrep-c1');
      expect(kube.deleteSecret).toHaveBeenCalledWith('cd-scan-opengrep-c1-run');
    });

    it('deleteScannerPodStrict rejects on a Kubernetes error', async () => {
      const kube = kubeOf();
      kube.deleteSecret.mockRejectedValueOnce(
        new Error('deleteSecret failed status=403'),
      );
      const pods = new CommunityScannerPods(enabled, asKube(kube), cfg());
      await expect(
        pods.deleteScannerPodStrict('cd-scan-opengrep-c1'),
      ).rejects.toThrow('status=403');
    });

    it('a container that is not a catalogue pod is left alone', async () => {
      const kube = kubeOf();
      const pods = new CommunityScannerPods(enabled, asKube(kube), cfg());
      await pods.releaseTerminatedContainer(scan, {
        id: 'a',
        podName: 'agent',
        image: 'cybedefend/agent:1',
      } as Container);
      await pods.deleteScannerPodStrict('agent');
      expect(kube.deletePod).not.toHaveBeenCalled();
    });

    it('without the engine or while disabled: resolves, deletes nothing, as today', async () => {
      const kube = kubeOf();
      for (const pods of [
        new CommunityScannerPods(),
        new CommunityScannerPods(
          { enabled: false } as unknown as ClusterScanningState,
          asKube(kube),
          cfg(),
        ),
      ]) {
        await expect(
          pods.releaseTerminatedContainer(scan, clusterContainer),
        ).resolves.toBeUndefined();
        await expect(
          pods.deleteScannerPodStrict('cd-scan-opengrep-c1'),
        ).resolves.toBeUndefined();
      }
      expect(kube.deletePod).not.toHaveBeenCalled();
    });
  });
});
