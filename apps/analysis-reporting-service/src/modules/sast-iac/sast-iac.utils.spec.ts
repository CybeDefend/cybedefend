import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Not } from 'typeorm';
import { SastIacUtilsService } from './sast-iac.utils';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { CorrespondanceTable } from '../../entities/vulnerability/correspondance-table.entity';
import { CodeSnippet } from '../../entities/code-snippet.entity';
import { DataFlowItem } from '../../entities/data-flow-item.entity';
import { SastIacService } from './sast-iac.service';
import { ResultService } from '../result/result.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { Logger } from 'nestjs-pino';
import {
  CvssCalculatorService,
  SecurityContextForScoring,
} from '../cvss/cvss-calculator.service';
import { resolveEffectiveSeverity } from '../cvss/severity-from-cvss';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildRuleIndex,
  mapSarifResult,
} from '../results-import/sarif/sarif-mapper';
import type {
  SarifResult,
  SarifRunHeader,
} from '../results-import/sarif/sarif.types';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';
import { SecretEncryptionService } from '../../core/crypto/secret-encryption.service';

describe('SastIacUtilsService – exploitability updates', () => {
  let service: SastIacUtilsService;
  let sastRepo: any;
  let iacRepo: any;
  let resultService: {
    addHistoryItem: jest.Mock;
    recalculatePriority: jest.Mock;
    computeEnvironmentalForProject: jest.Mock;
  };
  let sastIacService: {
    getSastVulnerabilityByIdInProject: jest.Mock;
    getIacVulnerabilityByIdInProject: jest.Mock;
    getCicdVulnerabilityByIdInProject: jest.Mock;
    getSecretVulnerabilityByIdInProject: jest.Mock;
  };
  let cvssCalculator: { computeCvss4Base: jest.Mock };
  let cyberiskEnqueuer: { enqueue: jest.Mock };

  beforeEach(async () => {
    sastRepo = createMockRepository();
    iacRepo = createMockRepository();
    resultService = {
      addHistoryItem: jest.fn().mockResolvedValue(undefined),
      recalculatePriority: jest
        .fn()
        .mockResolvedValue({ priority: 'normal', compositeScore: 0.5 }),
      computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
    } as any;
    sastIacService = {
      getSastVulnerabilityByIdInProject: jest
        .fn()
        .mockResolvedValue({ vulnerability: {} }),
      getIacVulnerabilityByIdInProject: jest
        .fn()
        .mockResolvedValue({ vulnerability: {} }),
      getCicdVulnerabilityByIdInProject: jest
        .fn()
        .mockResolvedValue({ vulnerability: {} }),
      getSecretVulnerabilityByIdInProject: jest
        .fn()
        .mockResolvedValue({ vulnerability: {} }),
    };
    cvssCalculator = {
      computeCvss4Base: jest.fn().mockReturnValue({
        vector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
        baseScore: 9.3,
      }),
    };
    cyberiskEnqueuer = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SastIacUtilsService,
        {
          provide: getRepositoryToken(CodeSnippet),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(DataFlowItem),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CorrespondanceTable),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: sastRepo,
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: iacRepo,
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        { provide: SastIacService, useValue: sastIacService },
        { provide: ResultService, useValue: resultService },
        { provide: IssueIntegrationService, useValue: {} },
        { provide: CvssCalculatorService, useValue: cvssCalculator },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: SecretEncryptionService,
          useValue: {
            encrypt: jest.fn(() => 'v1:mock-iv:mock-ct:mock-tag'),
            hashSecretValue: jest.fn((v: string) => 'h:' + v),
          },
        },
        { provide: CyberiskRecomputeEnqueuer, useValue: cyberiskEnqueuer },
      ],
    }).compile();

    service = module.get(SastIacUtilsService);
  });

  // ── handleUpdateSast ──────────────────────────────────────────────

  describe('handleUpdateSast', () => {
    function makeSastVuln(
      overrides: Partial<SastVulnerabilityDetections> = {},
    ): SastVulnerabilityDetections {
      return {
        id: 'vuln-1',
        projectId: 'proj-1',
        currentState: 'to_verify',
        currentPriority: 'Normal',
        ...overrides,
      } as SastVulnerabilityDetections;
    }

    function makeDto(overrides: Record<string, any> = {}) {
      return {
        projectId: 'proj-1',
        vulnerabilityId: 'vuln-1',
        status: '',
        priority: '',
        comment: '',
        userId: 'user-1',
        exploitabilityScore: 0,
        exploitabilityVerdict: '',
        exploitabilityReason: '',
        exploitabilityScoreReason: '',
        exploitabilitySource: '',
        exploitabilityFactors: '',
        cvss4EnvAdjustments: '',
        scoringSource: '',
        agentToolCallId: '',
        agentConversationId: '',
        agentStreamId: '',
        ...overrides,
      };
    }

    it('derives the score deterministically from the verdict (ignores agent score)', async () => {
      const vuln = makeSastVuln();
      sastRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityScore: 0.85, // Agent-supplied — must be ignored
        exploitabilityVerdict: 'proven',
        exploitabilityReason: 'Data flow reaches user input',
        exploitabilitySource: 'agent',
      });

      await service.handleUpdateSast(vuln, dto);

      expect(vuln.exploitabilityScore).toBe(0.75); // VERDICT_TO_SCORE.proven
      expect(vuln.exploitabilityVerdict).toBe('proven');
      expect(vuln.exploitabilityReason).toBe('Data flow reaches user input');
      expect(vuln.exploitabilitySource).toBe('agent');
      expect(vuln.scoringSource).toBe('agent');
      expect(vuln.exploitabilityUpdatedAt).toBeInstanceOf(Date);
      expect(cyberiskEnqueuer.enqueue).toHaveBeenCalledWith(
        'proj-1',
        'vuln_update',
      );
    });

    // ── No exploitability scorer bound: the verdict table decides ──

    it('keeps the verdict table score and records no factors when no exploitability scorer is bound', async () => {
      const vuln = makeSastVuln();
      sastRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityVerdict: 'proven',
        exploitabilitySource: 'agent',
        exploitabilityFactors: JSON.stringify({
          attackVector: 'network',
          attackComplexity: 'low',
          privilegesRequired: 'none',
          userInteraction: 'none',
        }),
      });

      await service.handleUpdateSast(vuln, dto);

      expect(vuln.exploitabilityScore).toBe(0.75);
      const historyCall = resultService.addHistoryItem.mock.calls.find(
        (call) => call[0].type === 'exploitability_change',
      );
      expect(JSON.parse(historyCall![0].value)).toEqual({
        score: 0.75,
        verdict: 'proven',
      });
    });

    it('keeps the frozen 0.75 when the proven verdict is manual, factors or not', async () => {
      const vuln = makeSastVuln();
      sastRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityVerdict: 'proven',
        exploitabilitySource: 'manual',
        exploitabilityFactors: JSON.stringify({
          attackVector: 'network',
          attackComplexity: 'low',
          privilegesRequired: 'none',
          userInteraction: 'none',
        }),
      });

      await service.handleUpdateSast(vuln, dto);

      expect(vuln.exploitabilityScore).toBe(0.75);
    });

    it('keeps not_exploitable at 0.05 even when the agent supplies factors', async () => {
      const vuln = makeSastVuln();
      sastRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityVerdict: 'not_exploitable',
        exploitabilitySource: 'agent',
        exploitabilityFactors: JSON.stringify({
          attackVector: 'network',
          attackComplexity: 'low',
          privilegesRequired: 'none',
          userInteraction: 'none',
        }),
      });

      await service.handleUpdateSast(vuln, dto);

      expect(vuln.exploitabilityScore).toBe(0.05);
    });

    it('falls back to the frozen 0.75 when the factor payload is unusable', async () => {
      const vuln = makeSastVuln();
      sastRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityVerdict: 'proven',
        exploitabilitySource: 'agent',
        exploitabilityFactors: '{"attackVector":"network"}',
      });

      await service.handleUpdateSast(vuln, dto);

      expect(vuln.exploitabilityScore).toBe(0.75);
    });

    it('resets exploitability to null when verdict is not_evaluated', async () => {
      const vuln = makeSastVuln({
        exploitabilityVerdict: 'proven',
        exploitabilityScore: 0.75,
        exploitabilitySource: 'manual',
        scoringSource: 'agent',
        priorityManualOverride: true,
      } as any);
      sastRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({ exploitabilityVerdict: 'not_evaluated' });

      await service.handleUpdateSast(vuln, dto);

      expect(vuln.exploitabilityVerdict).toBeNull();
      expect(vuln.exploitabilitySource).toBeNull();
      // A reset must not leave the finding flagged as agent-scored,
      // but scoring_source is a NOT NULL enum column: it falls back to the
      // 'static' default rather than NULL, which previously crashed the
      // save() with "Column 'scoring_source' cannot be null".
      expect((vuln as any).scoringSource).toBe('static');
      expect((vuln as any).priorityManualOverride).toBe(false);
      const historyCall = resultService.addHistoryItem.mock.calls.find(
        ([h]: [any]) => h.type === 'exploitability_change',
      );
      expect(historyCall).toBeDefined();
    });

    it('forces the priority recompute past the freeze on a manual verdict change', async () => {
      const vuln = makeSastVuln({ priorityManualOverride: false } as any);
      sastRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityVerdict: 'proven',
        exploitabilitySource: 'manual',
      });

      await service.handleUpdateSast(vuln, dto);

      // The manual verdict freezes the priority against future automated crons…
      expect((vuln as any).priorityManualOverride).toBe(true);
      // …but the explicit change still recomputes the priority NOW.
      expect(resultService.recalculatePriority).toHaveBeenCalledWith(
        expect.anything(),
        'proj-1',
        undefined,
        expect.objectContaining({ forceRecompute: true }),
      );
    });

    it('records the derived score in the exploitability_change history item', async () => {
      const vuln = makeSastVuln();
      sastRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityScore: 0.5, // Ignored
        exploitabilityVerdict: 'theoretical',
      });

      await service.handleUpdateSast(vuln, dto);

      const historyCall = resultService.addHistoryItem.mock.calls.find(
        (call) => call[0].type === 'exploitability_change',
      );
      expect(historyCall).toBeDefined();

      const historyItem = historyCall[0];
      expect(historyItem.type).toBe('exploitability_change');
      const parsedValue = JSON.parse(historyItem.value);
      expect(parsedValue.score).toBe(0.35); // VERDICT_TO_SCORE.theoretical
      expect(parsedValue.verdict).toBe('theoretical');
      expect(historyItem.sastVulnerabilityDetection).toBe(vuln);
    });

    // A verdict with NO explicit source must NOT be silently
    // attributed to the agent. The gateway already forces 'manual' for
    // dashboard edits and the agent always sends 'agent' explicitly, so this
    // default branch is only reachable by a caller that omits the source —
    // which must never claim agent provenance. The safe default is 'manual'.
    it('defaults exploitabilitySource to "manual" when not provided', async () => {
      const vuln = makeSastVuln();
      sastRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityScore: 0.3,
        exploitabilityVerdict: 'not_exploitable',
        exploitabilitySource: '',
      });

      await service.handleUpdateSast(vuln, dto);

      expect(vuln.exploitabilitySource).toBe('manual');
      // scoringSource is a separate signal, intentionally left unchanged.
      expect(vuln.scoringSource).toBe('agent');
    });

    it('derives a non-zero score even when the agent supplies score=0', async () => {
      const vuln = makeSastVuln();
      sastRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityScore: 0,
        exploitabilityVerdict: 'not_exploitable',
      });

      await service.handleUpdateSast(vuln, dto);

      expect(vuln.exploitabilityScore).toBe(0.05); // VERDICT_TO_SCORE.not_exploitable
      expect(vuln.exploitabilityVerdict).toBe('not_exploitable');

      // exploitability_change history item should be created
      const historyCall = resultService.addHistoryItem.mock.calls.find(
        (call) => call[0].type === 'exploitability_change',
      );
      expect(historyCall).toBeDefined();
    });

    it('does NOT persist exploitability fields when both score and verdict are empty', async () => {
      const vuln = makeSastVuln();
      sastRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityScore: 0,
        exploitabilityVerdict: '',
      });

      await service.handleUpdateSast(vuln, dto);

      expect(vuln.exploitabilityScore).toBeUndefined();
      expect(vuln.exploitabilityVerdict).toBeUndefined();
    });

    // a manual exploitability verdict must auto-freeze the
    // priority label so EPSS/OSV/agent reanalyze cycles cannot churn it.
    it('sets priorityManualOverride=true when exploitabilitySource is manual', async () => {
      const vuln = makeSastVuln();
      sastRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityVerdict: 'not_exploitable',
        exploitabilityReason: 'in tests folder',
        exploitabilitySource: 'manual',
      });

      await service.handleUpdateSast(vuln, dto);

      expect(vuln.exploitabilitySource).toBe('manual');
      expect(vuln.priorityManualOverride).toBe(true);
    });

    it('does NOT auto-set priorityManualOverride for agent verdicts', async () => {
      const vuln = makeSastVuln();
      sastRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityVerdict: 'proven',
        exploitabilitySource: 'agent',
      });

      await service.handleUpdateSast(vuln, dto);

      expect(vuln.priorityManualOverride).toBeFalsy();
    });

    // agent audit ids must be propagated to every HistoryItem
    // produced by an HITL-confirmed update so analysts can pivot from a
    // history row back to the chat conversation.
    it('stamps agent audit ids on history items when the update comes from chat', async () => {
      const vuln = makeSastVuln();
      sastRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        status: 'resolved',
        agentToolCallId: 'tc-back47',
        agentConversationId: 'conv-back47',
        agentStreamId: 'stream-back47',
      });

      await service.handleUpdateSast(vuln, dto);

      const statusHistory = resultService.addHistoryItem.mock.calls.find(
        (call) => call[0].type === 'status_change',
      );
      expect(statusHistory).toBeDefined();
      const item = statusHistory![0];
      expect(item.source).toBe('chat_agent_assisted');
      expect(item.agentToolCallId).toBe('tc-back47');
      expect(item.agentConversationId).toBe('conv-back47');
      expect(item.agentStreamId).toBe('stream-back47');
    });

    // A human manual exploitability edit that shifts the priority
    // bucket must NOT attribute the recompute-derived priority_change to the
    // 'system' sentinel (which renders as the AI agent and falsely triggers
    // the "Analyzed by Agent Cybe" banner). It must inherit the human editor.
    it('attributes the recompute-derived priority_change to the human editor, not to system', async () => {
      const vuln = makeSastVuln(); // currentPriority 'Normal'
      sastRepo.save.mockResolvedValue(vuln);
      resultService.recalculatePriority.mockResolvedValue({
        priority: 'high',
        priorityScore: 0.8,
      });

      const dto = makeDto({
        userId: 'human-7',
        exploitabilityVerdict: 'proven',
        exploitabilitySource: 'manual',
      });

      await service.handleUpdateSast(vuln, dto);

      const priorityCall = resultService.addHistoryItem.mock.calls.find(
        (call) => call[0].type === 'priority_change',
      );
      expect(priorityCall).toBeDefined();
      expect(priorityCall![0].userId).toBe('human-7');
      expect(priorityCall![0].userId).not.toBe('system');
      expect(priorityCall![0].source).toBe('dashboard_manual');
    });

    // Non-regression — a genuine autonomous agent analysis sends
    // userId='system' + exploitabilitySource='agent', so the recompute-derived
    // priority_change must stay attributed to system (keeps the banner).
    it('keeps the recompute-derived priority_change attributed to system for autonomous agent analysis', async () => {
      const vuln = makeSastVuln();
      sastRepo.save.mockResolvedValue(vuln);
      resultService.recalculatePriority.mockResolvedValue({
        priority: 'high',
        priorityScore: 0.8,
      });

      const dto = makeDto({
        userId: 'system',
        exploitabilityVerdict: 'proven',
        exploitabilitySource: 'agent',
      });

      await service.handleUpdateSast(vuln, dto);

      const priorityCall = resultService.addHistoryItem.mock.calls.find(
        (call) => call[0].type === 'priority_change',
      );
      expect(priorityCall).toBeDefined();
      expect(priorityCall![0].userId).toBe('system');
      expect(priorityCall![0].source).toBe('system');
    });
  });

  // ── handleUpdateIac ───────────────────────────────────────────────

  describe('handleUpdateIac', () => {
    function makeIacVuln(
      overrides: Partial<IacVulnerabilityDetections> = {},
    ): IacVulnerabilityDetections {
      return {
        id: 'vuln-2',
        projectId: 'proj-1',
        currentState: 'to_verify',
        currentPriority: 'Normal',
        ...overrides,
      } as IacVulnerabilityDetections;
    }

    function makeDto(overrides: Record<string, any> = {}) {
      return {
        projectId: 'proj-1',
        vulnerabilityId: 'vuln-2',
        status: '',
        priority: '',
        comment: '',
        userId: 'user-1',
        exploitabilityScore: 0,
        exploitabilityVerdict: '',
        exploitabilityReason: '',
        exploitabilityScoreReason: '',
        exploitabilitySource: '',
        exploitabilityFactors: '',
        cvss4EnvAdjustments: '',
        scoringSource: '',
        agentToolCallId: '',
        agentConversationId: '',
        agentStreamId: '',
        ...overrides,
      };
    }

    it('derives the score deterministically from the verdict (ignores agent score)', async () => {
      const vuln = makeIacVuln();
      iacRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityScore: 0.9, // Ignored
        exploitabilityVerdict: 'actively_exploited',
        exploitabilityReason: 'Known exploit in the wild',
        exploitabilitySource: 'manual',
      });

      await service.handleUpdateIac(vuln, dto);

      expect(vuln.exploitabilityScore).toBe(0.95); // VERDICT_TO_SCORE.actively_exploited
      expect(vuln.exploitabilityVerdict).toBe('actively_exploited');
      expect(vuln.exploitabilityReason).toBe('Known exploit in the wild');
      expect(vuln.exploitabilitySource).toBe('manual');
      expect(vuln.scoringSource).toBeUndefined();
      expect(vuln.exploitabilityUpdatedAt).toBeInstanceOf(Date);
    });

    it('records the derived score in the exploitability_change history item', async () => {
      const vuln = makeIacVuln();
      iacRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityScore: 0.7, // Ignored
        exploitabilityVerdict: 'proven',
      });

      await service.handleUpdateIac(vuln, dto);

      const historyCall = resultService.addHistoryItem.mock.calls.find(
        (call) => call[0].type === 'exploitability_change',
      );
      expect(historyCall).toBeDefined();

      const historyItem = historyCall[0];
      expect(historyItem.type).toBe('exploitability_change');
      const parsedValue = JSON.parse(historyItem.value);
      expect(parsedValue.score).toBe(0.75); // VERDICT_TO_SCORE.proven
      expect(parsedValue.verdict).toBe('proven');
      expect(historyItem.iacVulnerabilityDetection).toBe(vuln);
    });

    it('keeps an IaC theoretical verdict frozen at 0.35 despite factors', async () => {
      const vuln = makeIacVuln();
      iacRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityVerdict: 'theoretical',
        exploitabilitySource: 'agent',
        exploitabilityFactors: JSON.stringify({
          attackVector: 'network',
          attackComplexity: 'low',
          privilegesRequired: 'none',
          userInteraction: 'none',
        }),
      });

      await service.handleUpdateIac(vuln, dto);

      expect(vuln.exploitabilityScore).toBe(0.35);
    });

    // Safe default 'manual' (see handleUpdateSast counterpart).
    it('defaults exploitabilitySource to "manual" when not provided', async () => {
      const vuln = makeIacVuln();
      iacRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityScore: 0.4,
        exploitabilityVerdict: 'theoretical',
        exploitabilitySource: '',
      });

      await service.handleUpdateIac(vuln, dto);

      expect(vuln.exploitabilitySource).toBe('manual');
      expect(vuln.scoringSource).toBe('agent');
    });

    // Manual edit must attribute the recompute-derived priority_change
    // to the human editor (not the 'system' sentinel).
    it('attributes the recompute-derived priority_change to the human editor, not to system', async () => {
      const vuln = makeIacVuln(); // currentPriority 'Normal'
      iacRepo.save.mockResolvedValue(vuln);
      resultService.recalculatePriority.mockResolvedValue({
        priority: 'high',
        priorityScore: 0.8,
      });

      const dto = makeDto({
        userId: 'human-9',
        exploitabilityVerdict: 'proven',
        exploitabilitySource: 'manual',
      });

      await service.handleUpdateIac(vuln, dto);

      const priorityCall = resultService.addHistoryItem.mock.calls.find(
        (call) => call[0].type === 'priority_change',
      );
      expect(priorityCall).toBeDefined();
      expect(priorityCall![0].userId).toBe('human-9');
      expect(priorityCall![0].userId).not.toBe('system');
      expect(priorityCall![0].source).toBe('dashboard_manual');
    });

    // Non-regression — autonomous agent keeps system attribution.
    it('keeps the recompute-derived priority_change attributed to system for autonomous agent analysis', async () => {
      const vuln = makeIacVuln();
      iacRepo.save.mockResolvedValue(vuln);
      resultService.recalculatePriority.mockResolvedValue({
        priority: 'high',
        priorityScore: 0.8,
      });

      const dto = makeDto({
        userId: 'system',
        exploitabilityVerdict: 'proven',
        exploitabilitySource: 'agent',
      });

      await service.handleUpdateIac(vuln, dto);

      const priorityCall = resultService.addHistoryItem.mock.calls.find(
        (call) => call[0].type === 'priority_change',
      );
      expect(priorityCall).toBeDefined();
      expect(priorityCall![0].userId).toBe('system');
      expect(priorityCall![0].source).toBe('system');
    });

    it('derives a non-zero score even when the agent supplies score=0', async () => {
      const vuln = makeIacVuln();
      iacRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityScore: 0,
        exploitabilityVerdict: 'not_exploitable',
      });

      await service.handleUpdateIac(vuln, dto);

      expect(vuln.exploitabilityScore).toBe(0.05); // VERDICT_TO_SCORE.not_exploitable
      expect(vuln.exploitabilityVerdict).toBe('not_exploitable');

      const historyCall = resultService.addHistoryItem.mock.calls.find(
        (call) => call[0].type === 'exploitability_change',
      );
      expect(historyCall).toBeDefined();
    });

    it('does NOT persist exploitability fields when both score and verdict are empty', async () => {
      const vuln = makeIacVuln();
      iacRepo.save.mockResolvedValue(vuln);

      const dto = makeDto({
        exploitabilityScore: 0,
        exploitabilityVerdict: '',
      });

      await service.handleUpdateIac(vuln, dto);

      expect(vuln.exploitabilityScore).toBeUndefined();
      expect(vuln.exploitabilityVerdict).toBeUndefined();
    });
  });

  // ── handleUpdateCicd ──────────────────────────────────────────────

  describe('handleUpdateCicd', () => {
    function makeCicdVuln(
      overrides: Partial<CicdVulnerabilityDetections> = {},
    ): CicdVulnerabilityDetections {
      return {
        id: 'vuln-cicd',
        projectId: 'proj-1',
        currentState: 'to_verify',
        currentPriority: 'Normal',
        ...overrides,
      } as CicdVulnerabilityDetections;
    }

    function makeDto(overrides: Record<string, any> = {}) {
      return {
        projectId: 'proj-1',
        vulnerabilityId: 'vuln-cicd',
        status: '',
        priority: '',
        comment: '',
        userId: 'user-1',
        exploitabilityScore: 0,
        exploitabilityVerdict: '',
        exploitabilityReason: '',
        exploitabilityScoreReason: '',
        exploitabilitySource: '',
        exploitabilityFactors: '',
        cvss4EnvAdjustments: '',
        scoringSource: '',
        agentToolCallId: '',
        agentConversationId: '',
        agentStreamId: '',
        ...overrides,
      };
    }

    // Safe default 'manual' (see handleUpdateSast counterpart).
    it('defaults exploitabilitySource to "manual" when not provided', async () => {
      const vuln = makeCicdVuln();
      const dto = makeDto({
        exploitabilityScore: 0.3,
        exploitabilityVerdict: 'not_exploitable',
        exploitabilitySource: '',
      });

      await service.handleUpdateCicd(vuln, dto as any);

      expect(vuln.exploitabilitySource).toBe('manual');
    });

    // Manual edit attributes the recompute-derived priority_change
    // to the human editor (not the 'system' sentinel).
    it('attributes the recompute-derived priority_change to the human editor, not to system', async () => {
      const vuln = makeCicdVuln(); // currentPriority 'Normal'
      resultService.recalculatePriority.mockResolvedValue({
        priority: 'high',
        priorityScore: 0.8,
      });

      const dto = makeDto({
        userId: 'human-11',
        exploitabilityVerdict: 'proven',
        exploitabilitySource: 'manual',
      });

      await service.handleUpdateCicd(vuln, dto as any);

      const priorityCall = resultService.addHistoryItem.mock.calls.find(
        (call) => call[0].type === 'priority_change',
      );
      expect(priorityCall).toBeDefined();
      expect(priorityCall![0].userId).toBe('human-11');
      expect(priorityCall![0].userId).not.toBe('system');
      expect(priorityCall![0].source).toBe('dashboard_manual');
    });

    // Non-regression — autonomous agent keeps system attribution.
    it('keeps the recompute-derived priority_change attributed to system for autonomous agent analysis', async () => {
      const vuln = makeCicdVuln();
      resultService.recalculatePriority.mockResolvedValue({
        priority: 'high',
        priorityScore: 0.8,
      });

      const dto = makeDto({
        userId: 'system',
        exploitabilityVerdict: 'proven',
        exploitabilitySource: 'agent',
      });

      await service.handleUpdateCicd(vuln, dto as any);

      const priorityCall = resultService.addHistoryItem.mock.calls.find(
        (call) => call[0].type === 'priority_change',
      );
      expect(priorityCall).toBeDefined();
      expect(priorityCall![0].userId).toBe('system');
      expect(priorityCall![0].source).toBe('system');
    });
  });

  // ── createNewVulnerability – CVSS4 population ─────────────────────

  describe('createNewVulnerability – CVSS4 population', () => {
    it('should set cvss4Vector and cvss4BaseScore from vulnerability cvss3', async () => {
      sastRepo.find!.mockResolvedValue([]);

      const correspondance = {
        vulnerabilityType: 'sast',
        vulnerability: {
          id: 'vuln-1',
          severity: 'high',
          cvss3: {
            vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
            baseScore: '9.8',
          },
        },
      } as any;

      const vulnDto = {
        ruleId: 'rule-1',
        path: '/src/file.ts',
        language: 'typescript',
        codeSnippet: {
          vulnerableStartLine: 10,
          vulnerableEndLine: 15,
          code: ['line'],
          startLine: 8,
          endLine: 20,
        },
      } as any;

      await service.createNewVulnerability(
        vulnDto,
        correspondance,
        'scan-1',
        'project-1',
        'semgrep',
      );

      expect(cvssCalculator.computeCvss4Base).toHaveBeenCalledWith({
        cvss3Vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        severity: 'high',
      });

      const savedEntity = sastRepo.save!.mock.calls[0][0];
      expect(savedEntity.cvss4Vector).toBe(
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
      );
      expect(savedEntity.cvss4BaseScore).toBe(9.3);
    });

    it('does NOT persist an informational finding whose effective severity is non-displayable (scanner severity none)', async () => {
      sastRepo.find!.mockResolvedValue([]);
      // A pure-hygiene rule (e.g. "Redundant Tool Usage in Dockerfiles") has no
      // CVSS vector/score, so computeCvss4Base yields null and the effective
      // band falls back to the non-displayable 'none' label.
      cvssCalculator.computeCvss4Base.mockReturnValueOnce(null);

      const correspondance = {
        vulnerabilityType: 'sast',
        vulnerability: { id: 'vuln-none', severity: 'none' },
      } as any;
      const vulnDto = {
        ruleId: 'rule-none',
        path: '/.devcontainer/Dockerfile',
        language: 'dockerfile',
        codeSnippet: {
          vulnerableStartLine: 1,
          vulnerableEndLine: 1,
          code: ['line'],
          startLine: 1,
          endLine: 1,
        },
      } as any;

      await service.createNewVulnerability(
        vulnDto,
        correspondance,
        'scan-1',
        'project-1',
        'checkov',
      );

      expect(sastRepo.save).not.toHaveBeenCalled();
    });

    it('should pass cvss4BaseScore to recalculatePriority', async () => {
      sastRepo.find!.mockResolvedValue([]);

      const correspondance = {
        vulnerabilityType: 'sast',
        vulnerability: {
          id: 'vuln-1',
          severity: 'high',
          cvss3: {
            vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
            baseScore: '9.8',
          },
        },
      } as any;

      const vulnDto = {
        ruleId: 'rule-1',
        path: '/src/file.ts',
        language: 'typescript',
        codeSnippet: {
          vulnerableStartLine: 10,
          vulnerableEndLine: 15,
          code: ['line'],
          startLine: 8,
          endLine: 20,
        },
      } as any;

      await service.createNewVulnerability(
        vulnDto,
        correspondance,
        'scan-1',
        'project-1',
        'semgrep',
      );

      expect(resultService.recalculatePriority).toHaveBeenCalledWith(
        expect.objectContaining({
          cvss4BaseScore: 9.3,
        }),
        'project-1',
      );
    });

    it('persists environmental vector + score when project context exists', async () => {
      sastRepo.find!.mockResolvedValue([]);
      resultService.computeEnvironmentalForProject.mockResolvedValueOnce({
        fullVector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/IR:H/AR:H',
        baseScore: 9.3,
        environmentalScore: 9.8,
      });

      const correspondance = {
        vulnerabilityType: 'sast',
        vulnerability: {
          id: 'vuln-1',
          severity: 'high',
          cvss3: {
            vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
            baseScore: '9.8',
          },
        },
      } as any;

      const vulnDto = {
        ruleId: 'rule-1',
        path: '/src/file.ts',
        language: 'typescript',
        codeSnippet: {
          vulnerableStartLine: 10,
          vulnerableEndLine: 15,
          code: ['line'],
          startLine: 8,
          endLine: 20,
        },
      } as any;

      await service.createNewVulnerability(
        vulnDto,
        correspondance,
        'scan-1',
        'project-1',
        'semgrep',
      );

      expect(resultService.computeEnvironmentalForProject).toHaveBeenCalledWith(
        'project-1',
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
      );
      const saved = sastRepo.save!.mock.calls[0][0];
      expect(saved.cvss4EnvironmentalScore).toBe(9.8);
      expect(saved.cvss4EnvironmentalVector).toBe(
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/IR:H/AR:H',
      );
      expect(saved.effectiveSeverity).toBe('critical');
      expect(resultService.recalculatePriority).toHaveBeenCalledWith(
        expect.objectContaining({ cvss4EnvironmentalScore: 9.8 }),
        'project-1',
      );
    });

    it('falls back to base score and null vector when no project context exists', async () => {
      sastRepo.find!.mockResolvedValue([]);
      resultService.computeEnvironmentalForProject.mockResolvedValueOnce(null);

      const correspondance = {
        vulnerabilityType: 'sast',
        vulnerability: {
          id: 'vuln-1',
          severity: 'high',
          cvss3: {
            vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
            baseScore: '9.8',
          },
        },
      } as any;

      const vulnDto = {
        ruleId: 'rule-1',
        path: '/src/file.ts',
        language: 'typescript',
        codeSnippet: {
          vulnerableStartLine: 10,
          vulnerableEndLine: 15,
          code: ['line'],
          startLine: 8,
          endLine: 20,
        },
      } as any;

      await service.createNewVulnerability(
        vulnDto,
        correspondance,
        'scan-1',
        'project-1',
        'semgrep',
      );

      const saved = sastRepo.save!.mock.calls[0][0];
      expect(saved.cvss4EnvironmentalScore).toBe(9.3);
      expect(saved.cvss4EnvironmentalVector).toBeNull();
    });

    // A finding with no CVSS of its own keeps the severity its tool gave: the
    // default vector of its label scores inside that band, and the project's
    // security context (here the default one: production, public,
    // confidential) does not move it, since the vector's metrics are invented.
    // Every row of severity-mapping.sarif goes through the import mapper,
    // then through the real calculator.
    it('keeps the SARIF severity of every row of severity-mapping.sarif under the default security context', async () => {
      const real = new CvssCalculatorService();
      cvssCalculator.computeCvss4Base.mockImplementation((input) =>
        real.computeCvss4Base(input),
      );
      const defaultContext: SecurityContextForScoring = {
        environment: 'production',
        internetExposure: 'public',
        dataClassification: 'confidential',
        businessCriticality: 'medium',
        networkSegmentation: 'flat',
        handlesPii: false,
        handlesPaymentData: false,
        safetyCritical: false,
      };
      resultService.computeEnvironmentalForProject.mockImplementation(
        async (_projectId: string, vector: string) =>
          real.applyEnvironmentalMetrics(vector, defaultContext),
      );
      sastRepo.find!.mockResolvedValue([]);

      const sarif = readFileSync(
        join(
          __dirname,
          '../../../../../libs/test-fixtures/sarif/severity-mapping.sarif',
        ),
        'utf8',
      );
      const [run] = JSON.parse(sarif).runs;
      const header: SarifRunHeader = {
        index: 0,
        tool: run.tool,
        originalUriBaseIds: {},
        artifacts: [],
        resultCount: run.results.length,
      };
      const rules = buildRuleIndex(run.tool);
      const imported = run.results.map((result: SarifResult) => {
        const outcome = mapSarifResult(
          result,
          header,
          rules,
          'semgrep',
          'sast',
        );
        if (outcome.kind !== 'mapped') throw new Error('not mapped');
        return outcome.dto;
      });
      expect(new Set(imported.map((dto) => dto.severity))).toEqual(
        new Set(['critical', 'high', 'medium', 'low']),
      );

      for (const [n, dto] of imported.entries()) {
        await service.createNewVulnerability(
          {
            ruleId: dto.ruleId,
            path: 'src/sev.py',
            language: 'generic',
            codeSnippet: {
              vulnerableStartLine: n + 1,
              vulnerableEndLine: n + 1,
              code: ['line'],
              startLine: n + 1,
              endLine: n + 1,
            },
          } as any,
          {
            vulnerabilityType: 'sast',
            vulnerability: {
              id: `vuln-${n}`,
              severity: dto.severity,
              cvss3: null,
            },
          } as any,
          'scan-1',
          'project-1',
          'semgrep',
        );
      }

      const saved = sastRepo.save!.mock.calls.map((call) => call[0]);
      expect(saved).toHaveLength(imported.length);
      expect(
        saved.map((row) => [
          row.currentSeverity,
          row.effectiveSeverity,
          resolveEffectiveSeverity(row),
        ]),
      ).toEqual(
        imported.map((dto) => [dto.severity, dto.severity, dto.severity]),
      );
      for (const row of saved) {
        expect(row.cvss4EnvironmentalScore).toBe(row.cvss4BaseScore);
        expect(row.cvss4EnvironmentalVector).toBeNull();
      }
      expect(
        resultService.computeEnvironmentalForProject,
      ).not.toHaveBeenCalled();
    });
  });

  // ── createNewVulnerability – static exploitability ─────────────────

  describe('createNewVulnerability – static exploitability population', () => {
    function makeCorrespondance(severity = 'high') {
      return {
        vulnerabilityType: 'sast',
        vulnerability: {
          id: 'vuln-1',
          severity,
          cvss3: {
            vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
            baseScore: '9.8',
          },
        },
      } as any;
    }

    function makeVulnDto() {
      return {
        ruleId: 'rule-1',
        path: '/src/file.ts',
        language: 'typescript',
        codeSnippet: {
          vulnerableStartLine: 10,
          vulnerableEndLine: 15,
          code: ['line'],
          startLine: 8,
          endLine: 20,
        },
      } as any;
    }

    it('sets exploitabilitySource=static on new SAST detection', async () => {
      sastRepo.find!.mockResolvedValue([]);

      await service.createNewVulnerability(
        makeVulnDto(),
        makeCorrespondance('high'),
        'scan-1',
        'project-1',
        'semgrep',
      );

      const saved = sastRepo.save!.mock.calls[0][0];
      expect(saved.exploitabilitySource).toBe('static');
    });

    it('sets exploitabilityVerdict to a non-null value on new SAST detection', async () => {
      sastRepo.find!.mockResolvedValue([]);

      await service.createNewVulnerability(
        makeVulnDto(),
        makeCorrespondance('critical'),
        'scan-1',
        'project-1',
        'semgrep',
      );

      const saved = sastRepo.save!.mock.calls[0][0];
      expect(saved.exploitabilityVerdict).toBeTruthy();
    });

    it('sets exploitabilityScore > 0 on new SAST detection', async () => {
      sastRepo.find!.mockResolvedValue([]);

      await service.createNewVulnerability(
        makeVulnDto(),
        makeCorrespondance('critical'),
        'scan-1',
        'project-1',
        'semgrep',
      );

      const saved = sastRepo.save!.mock.calls[0][0];
      expect(saved.exploitabilityScore).toBeGreaterThan(0);
    });
  });

  describe('handleUpdateSecret', () => {
    function makeSecretVuln(overrides: any = {}) {
      return {
        id: 'sec-1',
        projectId: 'proj-1',
        currentState: 'to_verify',
        currentPriority: 'critical_urgent',
        priorityScore: 100,
        ...overrides,
      } as any;
    }

    function makeSecretDto(overrides: any = {}) {
      return {
        projectId: 'proj-1',
        vulnerabilityId: 'sec-1',
        status: '',
        priority: '',
        comment: '',
        userId: 'user-1',
        exploitabilityScore: 0,
        exploitabilityVerdict: '',
        exploitabilityReason: '',
        exploitabilityScoreReason: '',
        exploitabilitySource: '',
        scoringSource: '',
        ...overrides,
      };
    }

    it('ignores exploitability on a secret update — never populates exploitability fields nor runs the composite', async () => {
      const vuln = makeSecretVuln();
      const dto = makeSecretDto({
        exploitabilityVerdict: 'proven',
        exploitabilityReason: 'analyst note',
        exploitabilitySource: 'manual',
      });

      await service.handleUpdateSecret(vuln, dto as any);

      expect(vuln.exploitabilityVerdict ?? null).toBeNull();
      expect(vuln.exploitabilityScore ?? null).toBeNull();
      expect(vuln.exploitabilitySource ?? null).toBeNull();
      // Secrets never go through the multi-signal composite.
      expect(resultService.recalculatePriority).not.toHaveBeenCalled();
      // A deterministic secret priority is not churned by an exploitability verdict.
      expect(vuln.currentPriority).toBe('critical_urgent');
    });

    it('still applies a manual priority override on a secret', async () => {
      const vuln = makeSecretVuln();
      const dto = makeSecretDto({ priority: 'urgent' });

      await service.handleUpdateSecret(vuln, dto as any);

      expect(vuln.currentPriority).toBe('urgent');
      expect(vuln.priorityManualOverride).toBe(true);
      expect(resultService.recalculatePriority).not.toHaveBeenCalled();
    });
  });
});

describe('SastIacUtilsService.createNewVulnerability', () => {
  let utils: SastIacUtilsService;
  let secretRepoSave: jest.Mock;
  let sastRepoSave: jest.Mock;

  beforeEach(async () => {
    secretRepoSave = jest.fn().mockImplementation((x) => Promise.resolve(x));
    sastRepoSave = jest.fn().mockImplementation((x) => Promise.resolve(x));

    const secretRepo = {
      ...createMockRepository(),
      find: jest.fn().mockResolvedValue([]),
      save: secretRepoSave,
    };
    const sastRepo = {
      ...createMockRepository(),
      find: jest.fn().mockResolvedValue([]),
      save: sastRepoSave,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SastIacUtilsService,
        {
          provide: getRepositoryToken(CodeSnippet),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(DataFlowItem),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CorrespondanceTable),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: sastRepo,
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: {
            ...createMockRepository(),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: {
            ...createMockRepository(),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: secretRepo,
        },
        { provide: SastIacService, useValue: {} },
        {
          provide: ResultService,
          useValue: {
            computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
            recalculatePriority: jest
              .fn()
              .mockResolvedValue({ priority: 'normal', compositeScore: 0.5 }),
            addHistoryItem: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: IssueIntegrationService, useValue: {} },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: SecretEncryptionService,
          useValue: {
            encrypt: jest.fn(() => 'v1:mock-iv:mock-ct:mock-tag'),
            hashSecretValue: jest.fn((v: string) => 'h:' + v),
          },
        },
        {
          provide: CvssCalculatorService,
          useValue: {
            computeCvss4Base: jest.fn().mockReturnValue({
              vector:
                'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
              baseScore: 9.3,
            }),
          },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    utils = module.get(SastIacUtilsService);

    // Suppress downstream side-effects we don't care about for this test.
    jest
      .spyOn(utils as any, 'addVulnerabilityDetectionHistory')
      .mockResolvedValue(undefined);
    jest
      .spyOn(utils as any, 'addCodeSnippetToDetection')
      .mockResolvedValue(undefined);
  });

  it('stores the scanner-provided description in contextualExplanation for a secret finding (history-scan commit metadata)', async () => {
    const enrichedDescription =
      'Secret detected: AWS Access Key\n\n' +
      'Commit: 8ddc091aabbccddeeff00112233445566778899\n' +
      'Author: Alice Developer\n' +
      'Date: 2026-04-08\n' +
      'Message: feat(backup): add S3 backup script';

    const vulnDto: any = {
      ruleId: 'gitleaks-aws-access-token',
      path: 'scripts/backup.py',
      language: 'python',
      name: 'Hardcoded AWS Access Token',
      description: enrichedDescription,
      severity: 'CRITICAL',
      confidence: 'HIGH',
      fileHash: 'deadbeef',
      codeSnippet: {
        vulnerableStartLine: 4,
        vulnerableEndLine: 5,
        snippet: '...',
      },
      dataFlow: [],
    };

    const correspondance: any = {
      vulnerabilityType: 'secret',
      vulnerability: {
        id: 'vuln-aws-access-token',
        severity: 'CRITICAL',
      },
    };

    await utils.createNewVulnerability(
      vulnDto,
      correspondance,
      'scan-id-123',
      'project-id-456',
      'gitleaks',
      'main',
    );

    expect(secretRepoSave).toHaveBeenCalledTimes(1);
    const saved = secretRepoSave.mock
      .calls[0][0] as SecretVulnerabilityDetections;
    expect(saved.contextualExplanation).toBe(enrichedDescription);
    // Sanity: other fields are still wired up correctly
    expect(saved.path).toBe('scripts/backup.py');
    expect(saved.vulnerableStartLine).toBe(4);
    expect(saved.branch).toBe('main');
    expect(saved.scannerType).toBe('gitleaks');
  });

  it('stores contextualExplanation as null when the scanner does not provide a description', async () => {
    const vulnDto: any = {
      ruleId: 'gitleaks-github-pat',
      path: '.env.local',
      language: 'env',
      name: 'Hardcoded Github Pat',
      description: '',
      severity: 'CRITICAL',
      confidence: 'HIGH',
      fileHash: 'cafebabe',
      codeSnippet: {
        vulnerableStartLine: 2,
        vulnerableEndLine: 2,
        snippet: '...',
      },
      dataFlow: [],
    };

    const correspondance: any = {
      vulnerabilityType: 'secret',
      vulnerability: {
        id: 'vuln-github-pat',
        severity: 'CRITICAL',
      },
    };

    await utils.createNewVulnerability(
      vulnDto,
      correspondance,
      'scan-id-124',
      'project-id-456',
      'gitleaks',
      'main',
    );

    const saved = secretRepoSave.mock
      .calls[0][0] as SecretVulnerabilityDetections;
    expect(saved.contextualExplanation).toBeNull();
  });

  it('populates contextualExplanation for SAST findings too (when the scanner provides one)', async () => {
    const vulnDto: any = {
      ruleId: 'bandit-B102',
      path: 'app.py',
      language: 'python',
      name: 'Exec used',
      description: 'Use of exec() can lead to code injection',
      severity: 'HIGH',
      confidence: 'MEDIUM',
      fileHash: 'aaaabbbb',
      codeSnippet: {
        vulnerableStartLine: 10,
        vulnerableEndLine: 10,
        snippet: 'exec(payload)',
      },
      dataFlow: [],
    };

    const correspondance: any = {
      vulnerabilityType: 'sast',
      vulnerability: {
        id: 'vuln-bandit-B102',
        severity: 'HIGH',
      },
    };

    await utils.createNewVulnerability(
      vulnDto,
      correspondance,
      'scan-id-125',
      'project-id-456',
      'bandit',
      'main',
    );

    expect(sastRepoSave).toHaveBeenCalledTimes(1);
    const saved = sastRepoSave.mock.calls[0][0] as SastVulnerabilityDetections;
    expect(saved.contextualExplanation).toBe(
      'Use of exec() can lead to code injection',
    );
  });

  it('assigns critical_urgent / 100 to a secret and stores NO exploitability, even in a test file', async () => {
    const vulnDto: any = {
      ruleId: 'gitleaks-generic-api-key',
      path: 'src/auth/login.test.ts', // genuine test file — must NOT demote
      language: 'typescript',
      description: 'Generic API key',
      severity: 'CRITICAL',
      fileHash: 'feedface',
      // A realistic, high-entropy value — NOT a fake, so it is created.
      secretValue: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYz9aQ1Lm',
      secretSource: 'head',
      codeSnippet: {
        vulnerableStartLine: 2,
        vulnerableEndLine: 2,
        snippet: '...',
      },
      dataFlow: [],
    };

    const correspondance: any = {
      vulnerabilityType: 'secret',
      vulnerability: {
        id: 'vuln-generic-api-key',
        severity: 'CRITICAL',
      },
    };

    await utils.createNewVulnerability(
      vulnDto,
      correspondance,
      'scan-id-prio',
      'project-id-456',
      'gitleaks',
      'main',
    );

    const saved = secretRepoSave.mock
      .calls[0][0] as SecretVulnerabilityDetections;
    // Deterministic rule: a leaked credential is always the worst case and the
    // file context never demotes it.
    expect(saved.currentPriority).toBe('critical_urgent');
    expect(saved.priorityScore).toBe(100);
    // Exploitability does not apply to a secret — the columns stay null.
    expect(saved.exploitabilityScore ?? null).toBeNull();
    expect(saved.exploitabilityVerdict ?? null).toBeNull();
    expect(saved.exploitabilitySource ?? null).toBeNull();
  });

  it('does NOT create a secret finding when the value is a fake/placeholder', async () => {
    const vulnDto: any = {
      ruleId: 'gitleaks-generic-api-key',
      path: 'src/config/settings.ts',
      language: 'typescript',
      description: 'Generic API key',
      severity: 'CRITICAL',
      fileHash: 'feedface',
      secretValue: 'your_api_key', // obvious placeholder
      secretSource: 'head',
      codeSnippet: {
        vulnerableStartLine: 2,
        vulnerableEndLine: 2,
        snippet: '...',
      },
      dataFlow: [],
    };

    const correspondance: any = {
      vulnerabilityType: 'secret',
      vulnerability: {
        id: 'vuln-generic-api-key',
        severity: 'CRITICAL',
      },
    };

    await utils.createNewVulnerability(
      vulnDto,
      correspondance,
      'scan-id-fake',
      'project-id-456',
      'gitleaks',
      'main',
    );

    // The fake secret is dropped at ingestion — nothing is persisted.
    expect(secretRepoSave).not.toHaveBeenCalled();
  });
});

describe('secret detection ingestion', () => {
  let utils: SastIacUtilsService;
  let secretRepoSave: jest.Mock;
  let encryptMock: jest.Mock;

  const baseSecretCorrespondance: any = {
    vulnerabilityType: 'secret',
    vulnerability: {
      id: 'vuln-gitleaks-aws-access-token',
      severity: 'CRITICAL',
    },
  };

  beforeEach(async () => {
    secretRepoSave = jest.fn().mockImplementation((x) => Promise.resolve(x));
    encryptMock = jest.fn(() => `v1:mock-iv:mock-ct:mock-tag`);

    const secretRepo = {
      ...createMockRepository(),
      find: jest.fn().mockResolvedValue([]),
      save: secretRepoSave,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SastIacUtilsService,
        {
          provide: getRepositoryToken(CodeSnippet),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(DataFlowItem),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CorrespondanceTable),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: {
            ...createMockRepository(),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: {
            ...createMockRepository(),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: {
            ...createMockRepository(),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: secretRepo,
        },
        { provide: SastIacService, useValue: {} },
        {
          provide: ResultService,
          useValue: {
            computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
            recalculatePriority: jest
              .fn()
              .mockResolvedValue({ priority: 'normal', compositeScore: 0.5 }),
            addHistoryItem: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: IssueIntegrationService, useValue: {} },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: SecretEncryptionService,
          useValue: {
            encrypt: encryptMock,
            hashSecretValue: jest.fn((v: string) => 'h:' + v),
          },
        },
        {
          provide: CvssCalculatorService,
          useValue: {
            computeCvss4Base: jest.fn().mockReturnValue({
              vector:
                'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
              baseScore: 9.3,
            }),
          },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    utils = module.get(SastIacUtilsService);

    jest
      .spyOn(utils as any, 'addVulnerabilityDetectionHistory')
      .mockResolvedValue(undefined);
    jest
      .spyOn(utils as any, 'addCodeSnippetToDetection')
      .mockResolvedValue(undefined);
  });

  it('encrypts secretValue and stores the envelope in encryptedSecret', async () => {
    const plaintext = 'AKIAIOSFODNN7EXAMPLE';

    const vulnDto: any = {
      ruleId: 'gitleaks-aws-access-token',
      path: 'scripts/backup.py',
      language: 'python',
      name: 'Hardcoded AWS Access Token',
      description: null,
      severity: 'CRITICAL',
      confidence: 'HIGH',
      fileHash: 'deadbeef',
      secretValue: plaintext,
      commitSha: 'abc123def456',
      secretSource: 'head',
      codeSnippet: {
        vulnerableStartLine: 4,
        vulnerableEndLine: 5,
        snippet: '...',
      },
      dataFlow: [],
    };

    await utils.createNewVulnerability(
      vulnDto,
      baseSecretCorrespondance,
      'scan-id-enc-1',
      'project-id-456',
      'gitleaks',
      'main',
    );

    expect(encryptMock).toHaveBeenCalledWith(plaintext);
    expect(secretRepoSave).toHaveBeenCalledTimes(1);
    const saved = secretRepoSave.mock
      .calls[0][0] as SecretVulnerabilityDetections;
    // encryptedSecret must be a Buffer containing the envelope (not plaintext)
    expect(Buffer.isBuffer(saved.encryptedSecret)).toBe(true);
    const envelope = (saved.encryptedSecret as Buffer).toString('utf8');
    expect(envelope).toBe('v1:mock-iv:mock-ct:mock-tag');
    expect(envelope).not.toContain(plaintext);
  });

  it('sets commitSha and source from proto fields', async () => {
    const vulnDto: any = {
      ruleId: 'gitleaks-aws-access-token',
      path: 'scripts/backup.py',
      language: 'python',
      name: 'Hardcoded AWS Access Token',
      description: null,
      severity: 'CRITICAL',
      confidence: 'HIGH',
      fileHash: 'deadbeef',
      secretValue: 'AKIAIOSFODNN7EXAMPLE',
      commitSha: 'abc123def456',
      secretSource: 'history',
      codeSnippet: {
        vulnerableStartLine: 4,
        vulnerableEndLine: 5,
        snippet: '...',
      },
      dataFlow: [],
    };

    await utils.createNewVulnerability(
      vulnDto,
      baseSecretCorrespondance,
      'scan-id-enc-2',
      'project-id-456',
      'gitleaks',
      'main',
    );

    const saved = secretRepoSave.mock
      .calls[0][0] as SecretVulnerabilityDetections;
    expect(saved.commitSha).toBe('abc123def456');
    expect(saved.source).toBe('history');
  });

  it('leaves encryptedSecret undefined when secretValue is absent', async () => {
    const vulnDto: any = {
      ruleId: 'gitleaks-aws-access-token',
      path: 'scripts/backup.py',
      language: 'python',
      name: 'Hardcoded AWS Access Token',
      description: null,
      severity: 'CRITICAL',
      confidence: 'HIGH',
      fileHash: 'deadbeef',
      // secretValue intentionally omitted
      commitSha: null,
      secretSource: undefined,
      codeSnippet: {
        vulnerableStartLine: 4,
        vulnerableEndLine: 5,
        snippet: '...',
      },
      dataFlow: [],
    };

    await utils.createNewVulnerability(
      vulnDto,
      baseSecretCorrespondance,
      'scan-id-enc-3',
      'project-id-456',
      'gitleaks',
      'main',
    );

    expect(encryptMock).not.toHaveBeenCalled();
    const saved = secretRepoSave.mock
      .calls[0][0] as SecretVulnerabilityDetections;
    expect(saved.encryptedSecret).toBeUndefined();
  });

  it('defaults source to "head" when secretSource is absent', async () => {
    const vulnDto: any = {
      ruleId: 'gitleaks-aws-access-token',
      path: 'scripts/backup.py',
      language: 'python',
      name: 'Hardcoded AWS Access Token',
      description: null,
      severity: 'CRITICAL',
      confidence: 'HIGH',
      fileHash: 'deadbeef',
      secretValue: 'some-secret',
      commitSha: null,
      // secretSource intentionally omitted
      codeSnippet: {
        vulnerableStartLine: 4,
        vulnerableEndLine: 5,
        snippet: '...',
      },
      dataFlow: [],
    };

    await utils.createNewVulnerability(
      vulnDto,
      baseSecretCorrespondance,
      'scan-id-enc-4',
      'project-id-456',
      'gitleaks',
      'main',
    );

    const saved = secretRepoSave.mock
      .calls[0][0] as SecretVulnerabilityDetections;
    expect(saved.source).toBe('head');
  });
});

describe('SastIacUtilsService — CICD ingestion history + resolution', () => {
  // Build a fully-wired SastIacUtilsService with configurable repo/service mocks.
  const buildUtils = async (opts: {
    sastRepo?: any;
    iacRepo?: any;
    cicdRepo?: any;
    histRepo?: any;
    correspondanceRepo?: any;
    resultService?: any;
    issueService?: any;
  }): Promise<SastIacUtilsService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SastIacUtilsService,
        {
          provide: getRepositoryToken(CodeSnippet),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(DataFlowItem),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CorrespondanceTable),
          useValue: opts.correspondanceRepo ?? createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: opts.histRepo ?? createMockRepository(),
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: opts.sastRepo ?? {
            ...createMockRepository(),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: opts.iacRepo ?? {
            ...createMockRepository(),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: opts.cicdRepo ?? {
            ...createMockRepository(),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: {
            ...createMockRepository(),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: SastIacService, useValue: {} },
        {
          provide: ResultService,
          useValue: opts.resultService ?? {
            addHistoryItem: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: IssueIntegrationService,
          useValue: opts.issueService ?? {
            closeIssuesForResolvedVulnerabilities: jest
              .fn()
              .mockResolvedValue(undefined),
          },
        },
        { provide: Logger, useValue: createLoggerMock() },
        { provide: SecretEncryptionService, useValue: {} },
        { provide: CvssCalculatorService, useValue: {} },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();
    return module.get(SastIacUtilsService);
  };

  const mkCicd = (id: string, state: string, path: string) =>
    Object.assign(new CicdVulnerabilityDetections(), {
      id,
      projectId: 'p1',
      currentState: state,
      path,
      language: 'yaml',
      vulnerableStartLine: 1,
      vulnerableEndLine: 2,
      scannerType: 'gitleaks',
      branch: 'main',
      createdAt: new Date(),
      codeSnippets: [],
      vulnerability: { id: `vuln-${id}` },
    });

  it('links the ingestion history to cicdVulnerabilityDetection for a CICD detection', async () => {
    const histSave = jest.fn().mockImplementation((x) => Promise.resolve(x));
    const utils = await buildUtils({
      histRepo: { ...createMockRepository(), save: histSave },
    });

    const cicd = mkCicd('cicd-1', 'to_verify', 'wf.yml');
    await (utils as any).addVulnerabilityDetectionHistory(cicd, 'scan-1');

    expect(histSave).toHaveBeenCalledTimes(1);
    const saved = histSave.mock.calls[0][0];
    expect(saved.scanId).toBe('scan-1');
    expect(saved.cicdVulnerabilityDetection).toBe(cicd);
    expect(saved.sastVulnerabilityDetection).toBeUndefined();
    expect(saved.iacVulnerabilityDetection).toBeUndefined();
  });

  it('returns existingCicdVulns from the CICD repository', async () => {
    const cicdA = mkCicd('cicd-a', 'to_verify', 'a.yml');
    const utils = await buildUtils({
      cicdRepo: {
        ...createMockRepository(),
        find: jest.fn().mockResolvedValue([cicdA]),
      },
    });

    const res: any = await (utils as any).getExistingVulnerabilities(
      'p1',
      'scan1',
      'gitleaks',
      'main',
    );

    expect(res.existingCicdVulns).toEqual([cicdA]);
  });

  it('records current-scan history and revives a resolved CICD finding on re-detection, without inserting a duplicate', async () => {
    const existing = Object.assign(
      mkCicd('cicd-existing', 'resolved', 'wf.yml'),
      {
        fileHash: 'hash-1',
        vulnerabilityDetectionHistory: [],
        vulnerability: { id: 'vuln-cicd' },
      },
    );
    const cicdSave = jest.fn().mockImplementation((x) => Promise.resolve(x));
    const cicdFind = jest.fn().mockResolvedValue([existing]);
    const histSave = jest.fn().mockImplementation((x) => Promise.resolve(x));

    const utils = await buildUtils({
      cicdRepo: { ...createMockRepository(), find: cicdFind, save: cicdSave },
      histRepo: { ...createMockRepository(), save: histSave },
    });

    const vulnDto: any = {
      ruleId: 'rules.cicd-secret',
      path: 'wf.yml',
      language: 'yaml',
      fileHash: 'hash-1',
      codeSnippet: {
        vulnerableStartLine: 1,
        vulnerableEndLine: 2,
        snippet: '...',
      },
      dataFlow: [],
    };
    const correspondance: any = {
      vulnerabilityType: 'cicd',
      vulnerability: { id: 'vuln-cicd', severity: 'HIGH' },
    };

    await (utils as any).createNewVulnerability(
      vulnDto,
      correspondance,
      'scan-new',
      'p1',
      'gitleaks',
      'main',
    );

    // The current scan is recorded on the EXISTING detection so finalize will
    // not wrongly resolve a still-present CICD finding.
    expect(histSave).toHaveBeenCalledTimes(1);
    expect(histSave.mock.calls[0][0].cicdVulnerabilityDetection).toBe(existing);
    expect(histSave.mock.calls[0][0].scanId).toBe('scan-new');

    // A previously-resolved finding is revived to_verify.
    expect(existing.currentState).toBe('to_verify');
    expect(cicdSave).toHaveBeenCalledWith(existing);

    // No duplicate insert: the repo is never asked to save a brand-new entity.
    const insertedNew = cicdSave.mock.calls.find(
      (c: any[]) => c[0].id !== 'cicd-existing',
    );
    expect(insertedNew).toBeUndefined();
  });

  it('resolves an absent CICD detection, preserves ignored, and keeps a re-detected CICD detection unresolved', async () => {
    const absent = mkCicd('cicd-absent', 'to_verify', 'absent.yml');
    const present = mkCicd('cicd-present', 'to_verify', 'present.yml');
    const ignored = mkCicd('cicd-ignored', 'ignored', 'ignored.yml');

    const cicdSave = jest.fn().mockImplementation((x) => Promise.resolve(x));
    const histRepo: any = createMockRepository();
    // The re-detected finding already carries a history row for the current
    // scan; the two others do not. ("seen in this scan" means
    // the scan has a history row for it, whatever a newer scan wrote since;
    // it is no longer read from each detection's latest row.)
    histRepo.find.mockImplementation((query: any) =>
      Promise.resolve(
        query?.where?.[0]?.scanId === 'NEW-SCAN'
          ? [
              {
                scanId: 'NEW-SCAN',
                cicdVulnerabilityDetection: { id: 'cicd-present' },
              },
            ]
          : [],
      ),
    );
    const closeIssues = jest.fn().mockResolvedValue(undefined);

    const utils = await buildUtils({
      cicdRepo: {
        ...createMockRepository(),
        find: jest.fn().mockResolvedValue([]),
        save: cicdSave,
      },
      histRepo,
      resultService: { addHistoryItem: jest.fn().mockResolvedValue(undefined) },
      issueService: { closeIssuesForResolvedVulnerabilities: closeIssues },
    });

    await (utils as any).finalizeOldScanVulnerabilities(
      [absent, present, ignored],
      [],
      'p1',
      'NEW-SCAN',
      'main',
    );

    // Absent from the new scan → resolved.
    expect(absent.currentState).toBe('resolved');
    // Still present (current-scan history) → untouched.
    expect(present.currentState).toBe('to_verify');
    // User decision → preserved.
    expect(ignored.currentState).toBe('ignored');

    const savedIds = cicdSave.mock.calls.map((c: any[]) => c[0].id);
    expect(savedIds).toContain('cicd-absent');
    expect(savedIds).not.toContain('cicd-present');
    expect(savedIds).not.toContain('cicd-ignored');

    // Issues are closed for the resolved CICD finding under the 'cicd' type.
    expect(closeIssues).toHaveBeenCalledWith(
      'p1',
      ['cicd-absent'],
      expect.any(String),
      'cicd',
    );
  });

  it('never treats detections of different scanner types as similar, even with identical path and snippet', async () => {
    const utils = await buildUtils({});
    const code = JSON.stringify([{ line: 1, content: 'run: curl evil' }]);
    const base = {
      path: '.github/workflows/ci.yml',
      vulnerableStartLine: 1,
      vulnerableEndLine: 1,
      codeSnippets: [{ code }],
    };
    const iac = Object.assign(new IacVulnerabilityDetections(), {
      ...base,
      id: 'iac-x',
    });
    const iac2 = Object.assign(new IacVulnerabilityDetections(), {
      ...base,
      id: 'iac-y',
    });
    const cicd = Object.assign(new CicdVulnerabilityDetections(), {
      ...base,
      id: 'cicd-x',
    });

    // Sanity: identical same-type detections still match (line-shift dedup).
    expect(await (utils as any).areVulnsSimilar(iac, iac2)).toBe(true);
    // A CICD and an IaC detection are never the same finding — the
    // shared finalize candidate pool must not cross-match them.
    expect(await (utils as any).areVulnsSimilar(iac, cicd)).toBe(false);
    expect(await (utils as any).areVulnsSimilar(cicd, iac)).toBe(false);
  });

  it('never treats detections of different catalogue rules as similar, even on the same line', async () => {
    const utils = await buildUtils({});
    const code = JSON.stringify([{ line: 61, content: 'containers:' }]);
    const base = {
      path: 'charts/cybedefend/templates/deployment-worker.yaml',
      vulnerableStartLine: 61,
      vulnerableEndLine: 61,
      codeSnippets: [{ code }],
    };
    const readiness = Object.assign(new IacVulnerabilityDetections(), {
      ...base,
      id: 'readiness',
      vulnerability: { id: 'cat-readiness' },
    });
    const readinessTwin = Object.assign(new IacVulnerabilityDetections(), {
      ...base,
      id: 'readiness-twin',
      vulnerability: { id: 'cat-readiness' },
    });
    const liveness = Object.assign(new IacVulnerabilityDetections(), {
      ...base,
      id: 'liveness',
      vulnerability: { id: 'cat-liveness' },
    });

    // Same rule, same line: still one finding that moved (line-shift repair).
    expect(await (utils as any).areVulnsSimilar(readiness, readinessTwin)).toBe(
      true,
    );
    // Two rules on one line are two findings: a cybedefend-ignore directive
    // neutralising one of them must not let it absorb the other.
    expect(await (utils as any).areVulnsSimilar(readiness, liveness)).toBe(
      false,
    );
    expect(await (utils as any).areVulnsSimilar(liveness, readiness)).toBe(
      false,
    );
  });
});

describe('SastIacUtilsService.finalizeOldScanVulnerabilities — preserve ignored', () => {
  let utils: SastIacUtilsService;
  let iacRepo: any;
  let histRepo: any;
  let addHistoryItem: jest.Mock;
  let closeIssues: jest.Mock;

  beforeEach(async () => {
    iacRepo = createMockRepository();
    iacRepo.find.mockResolvedValue([]); // allDbVulns (iac) — none beyond the params we pass
    iacRepo.save.mockImplementation(async (e: any) => e);
    const sastRepo: any = createMockRepository();
    sastRepo.find.mockResolvedValue([]); // allDbVulns (sast)
    histRepo = createMockRepository();
    histRepo.find.mockResolvedValue([]); // no current-scan history → trulyNewVulns empty
    histRepo.findOne.mockResolvedValue({ scanId: 'OLD-SCAN' }); // last history = a previous scan
    addHistoryItem = jest.fn().mockResolvedValue(undefined);
    closeIssues = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SastIacUtilsService,
        {
          provide: getRepositoryToken(CodeSnippet),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(DataFlowItem),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CorrespondanceTable),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: histRepo,
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: sastRepo,
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: iacRepo,
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: {
            ...createMockRepository(),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        { provide: SastIacService, useValue: {} },
        { provide: ResultService, useValue: { addHistoryItem } },
        {
          provide: IssueIntegrationService,
          useValue: { closeIssuesForResolvedVulnerabilities: closeIssues },
        },
        { provide: CvssCalculatorService, useValue: {} },
        { provide: Logger, useValue: createLoggerMock() },
        { provide: SecretEncryptionService, useValue: {} },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
      ],
    }).compile();
    utils = module.get(SastIacUtilsService);
  });

  const mkIac = (id: string, state: string, path: string) =>
    Object.assign(new IacVulnerabilityDetections(), {
      id,
      projectId: 'p1',
      currentState: state,
      path,
      language: 'hcl',
      vulnerableStartLine: 1,
      vulnerableEndLine: 2,
      scannerType: 'kics',
      branch: 'main',
      createdAt: new Date(),
      codeSnippets: [],
    });

  it('resolves to_verify and confirmed but PRESERVES ignored when absent from the new scan', async () => {
    const toVerify = mkIac('iac-tv', 'to_verify', 'a.tf');
    const confirmed = mkIac('iac-cf', 'confirmed', 'b.tf');
    const ignored = mkIac('iac-ig', 'ignored', 'c.tf');

    await utils.finalizeOldScanVulnerabilities(
      [toVerify, confirmed, ignored],
      [],
      'p1',
      'NEW-SCAN',
      'main',
    );

    expect(toVerify.currentState).toBe('resolved');
    expect(confirmed.currentState).toBe('resolved');
    // An ignored vulnerability is a user decision — it must NOT be auto-resolved.
    expect(ignored.currentState).toBe('ignored');

    const savedIds = iacRepo.save.mock.calls.map((c: any[]) => c[0].id);
    expect(savedIds).toContain('iac-tv');
    expect(savedIds).toContain('iac-cf');
    expect(savedIds).not.toContain('iac-ig');
  });
});

/**
 * The `where` of a scan's sightings read: the scan's SAST, IaC and CICD
 * history rows only, never its SCA or secret ones.
 */
const sightingsWhere = (scanId: string) => [
  { scanId, sastVulnerabilityDetection: Not(IsNull()) },
  { scanId, iacVulnerabilityDetection: Not(IsNull()) },
  { scanId, cicdVulnerabilityDetection: Not(IsNull()) },
];

/**
 * The `where` of a finalization's sightings read: the same rows plus the
 * scan's secret ones, in the same read, which finalize resolves secrets from.
 */
const finalizeSightingsWhere = (scanId: string) => [
  ...sightingsWhere(scanId),
  { scanId, secretVulnerabilityDetection: Not(IsNull()) },
];

/**
 * What the finalization READS. Every assertion counts the
 * repository calls the real code makes against mocked repositories, so a
 * reload or a per-detection query shows up as a number that grows.
 */
describe('SastIacUtilsService.finalizeOldScanVulnerabilities — reads', () => {
  let utils: SastIacUtilsService;
  let sastRepo: any;
  let iacRepo: any;
  let cicdRepo: any;
  let histRepo: any;
  let addHistoryItem: jest.Mock;

  beforeEach(async () => {
    const detectionRepo = () => {
      const repo: any = createMockRepository();
      repo.find.mockResolvedValue([]);
      repo.save.mockImplementation(async (e: any) => e);
      repo.remove = jest.fn(async (e: any) => e);
      return repo;
    };
    sastRepo = detectionRepo();
    iacRepo = detectionRepo();
    cicdRepo = detectionRepo();
    histRepo = createMockRepository();
    histRepo.find.mockResolvedValue([]);
    histRepo.findOne.mockResolvedValue(null);
    addHistoryItem = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SastIacUtilsService,
        {
          provide: getRepositoryToken(CodeSnippet),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(DataFlowItem),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CorrespondanceTable),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: histRepo,
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: sastRepo,
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: iacRepo,
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: cicdRepo,
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        { provide: SastIacService, useValue: {} },
        { provide: ResultService, useValue: { addHistoryItem } },
        {
          provide: IssueIntegrationService,
          useValue: {
            closeIssuesForResolvedVulnerabilities: jest
              .fn()
              .mockResolvedValue(undefined),
          },
        },
        { provide: CvssCalculatorService, useValue: {} },
        { provide: Logger, useValue: createLoggerMock() },
        { provide: SecretEncryptionService, useValue: {} },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
      ],
    }).compile();
    utils = module.get(SastIacUtilsService);
  });

  /** A history row of the current scan, as the history read returns it. */
  const sighting = (
    family: 'sast' | 'iac' | 'cicd',
    id: string,
    scanId = 'NEW-SCAN',
  ) => ({
    scanId,
    [`${family}VulnerabilityDetection`]: { id },
  });

  const relationsOf = (repo: any): string[][] =>
    repo.find.mock.calls.map((c: any[]) => c[0]?.relations ?? []);

  it('reloads the three detection tables without the history relation, keeping dataFlowItems for the merge', async () => {
    histRepo.find.mockResolvedValue([
      sighting('sast', 'sast-new'),
      sighting('iac', 'iac-new'),
      sighting('cicd', 'cicd-new'),
    ]);

    await utils.finalizeOldScanVulnerabilities(
      [],
      [],
      'p1',
      'NEW-SCAN',
      'main',
    );

    for (const repo of [sastRepo, iacRepo, cicdRepo]) {
      expect(repo.find).toHaveBeenCalled();
      for (const relations of relationsOf(repo)) {
        // The history of a merged-away detection goes with it through the
        // ON DELETE CASCADE foreign keys; nothing in the merge reads it.
        expect(relations).not.toContain('vulnerabilityDetectionHistory');
        expect(relations).toEqual(
          expect.arrayContaining(['vulnerability', 'codeSnippets']),
        );
      }
    }
    // updateAndRemove copies the newer detection's data-flow onto the survivor.
    for (const relations of relationsOf(sastRepo)) {
      expect(relations).toContain('dataFlowItems');
    }
  });

  const mkIac = (id: string, path: string) =>
    Object.assign(new IacVulnerabilityDetections(), {
      id,
      projectId: 'p1',
      currentState: 'to_verify',
      path,
      language: 'hcl',
      vulnerableStartLine: 1,
      vulnerableEndLine: 2,
      scannerType: 'kics',
      branch: 'main',
      createdAt: new Date(),
      codeSnippets: [],
      vulnerability: { id: `cat-${id}` },
    });

  /** Every read the finalization made, by kind. */
  const reads = () => ({
    historyFind: histRepo.find.mock.calls.length,
    historyFindOne: histRepo.findOne.mock.calls.length,
    detectionFind:
      sastRepo.find.mock.calls.length +
      iacRepo.find.mock.calls.length +
      cicdRepo.find.mock.calls.length,
  });

  const clearReads = () => {
    for (const repo of [histRepo, sastRepo, iacRepo, cicdRepo]) {
      repo.find.mockClear();
      repo.findOne.mockClear();
    }
  };

  it('makes the same number of reads for 1 and for 50 detections, none of them per detection', async () => {
    histRepo.find.mockResolvedValue([sighting('iac', 'iac-new')]);

    const readsFor = async (n: number) => {
      clearReads();
      const old = Array.from({ length: n }, (_, i) =>
        mkIac(`iac-${n}-${i}`, `f${i}.tf`),
      );
      await utils.finalizeOldScanVulnerabilities(
        old,
        [],
        'p1',
        'NEW-SCAN',
        'main',
      );
      return reads();
    };

    const one = await readsFor(1);
    const fifty = await readsFor(50);

    expect(fifty).toEqual(one);
    // "Already seen in this scan" comes from the one history read, never from
    // a lookup of each detection's last history row.
    expect(fifty.historyFindOne).toBe(0);
    expect(fifty.historyFind).toBe(1);
  });

  it('reads only the SAST, IaC and CICD history rows of the scan, never its SCA or secret ones', async () => {
    await utils.findScanSightingIds('NEW-SCAN');

    expect(histRepo.find).toHaveBeenCalledTimes(1);
    // The SCA ingestion writes one history row per detection per scan: an
    // unfiltered read by scanId carried all of them to every SAST/IaC batch.
    expect(histRepo.find.mock.calls[0][0].where).toEqual(
      sightingsWhere('NEW-SCAN'),
    );
  });

  it('keeps open a finding the scan sighted, even when a newer scan of the branch sighted it since', async () => {
    // Scans A and B overlap on the branch: A sighted D, then B sighted it
    // too, so D's latest history row is B's. Finalizing A must not resolve
    // what A itself saw: the rule is "A has a row for D", not "A wrote D's
    // latest row" (which closed D until B's finalization reopened nothing).
    histRepo.find.mockResolvedValue([sighting('iac', 'iac-d', 'SCAN-A')]);
    histRepo.findOne.mockResolvedValue({ scanId: 'SCAN-B' });
    const d = mkIac('iac-d', 'd.tf');
    const gone = mkIac('iac-gone', 'gone.tf');

    await utils.finalizeOldScanVulnerabilities(
      [d, gone],
      [],
      'p1',
      'SCAN-A',
      'main',
    );

    expect(d.currentState).toBe('to_verify');
    expect(gone.currentState).toBe('resolved');
  });

  it('keeps a detection the current scan sighted out of the resolution', async () => {
    histRepo.find.mockResolvedValue([sighting('iac', 'iac-seen')]);
    const seen = mkIac('iac-seen', 'seen.tf');
    const gone = mkIac('iac-gone', 'gone.tf');

    await utils.finalizeOldScanVulnerabilities(
      [seen, gone],
      [],
      'p1',
      'NEW-SCAN',
      'main',
    );

    expect(seen.currentState).toBe('to_verify');
    expect(gone.currentState).toBe('resolved');
    expect(histRepo.findOne).not.toHaveBeenCalled();
  });

  it("loads only the current scan's detections, by id, one query per relation", async () => {
    histRepo.find.mockResolvedValue([
      sighting('sast', 'sast-new'),
      sighting('iac', 'iac-new'),
    ]);

    await utils.finalizeOldScanVulnerabilities(
      [mkIac('iac-old', 'old.tf')],
      [],
      'p1',
      'NEW-SCAN',
      'main',
    );

    // One indexed read of the scan's history rows.
    expect(histRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: finalizeSightingsWhere('NEW-SCAN') }),
    );
    for (const [repo, ids] of [
      [sastRepo, ['sast-new']],
      [iacRepo, ['iac-new']],
    ] as const) {
      expect(repo.find).toHaveBeenCalledTimes(1);
      const options = repo.find.mock.calls[0][0];
      // The project's other detections are not read at all: the cost no
      // longer grows with the age of the project.
      expect(options.where.projectId).toBe('p1');
      expect(options.where.branch).toBe('main');
      expect(options.where.id.type).toBe('in');
      expect(options.where.id.value).toEqual(ids);
      // No cartesian product of codeSnippets x dataFlowItems.
      expect(options.relationLoadStrategy).toBe('query');
    }
    // No CICD detection was sighted: nothing to load.
    expect(cicdRepo.find).not.toHaveBeenCalled();
  });

  it('reuses the sightings it is handed: no history read, no reload', async () => {
    const seen = mkIac('iac-seen', 'seen.tf');
    const gone = mkIac('iac-gone', 'gone.tf');

    // Cast: the sixth parameter is what this test introduces.
    await (utils as any).finalizeOldScanVulnerabilities(
      [seen, gone],
      [],
      'p1',
      'NEW-SCAN',
      'main',
      { ids: new Set(['iac-seen']), detections: [] },
    );

    expect(reads()).toEqual({
      historyFind: 0,
      historyFindOne: 0,
      detectionFind: 0,
    });
    expect(seen.currentState).toBe('to_verify');
    expect(gone.currentState).toBe('resolved');
  });
});

/**
 * The rule map a batch matches its findings against, built
 * with set-based reads. It used to cost, per existing detection, a lookup of
 * its latest history row and a read of its catalogue vulnerability's
 * correspondances, which took tens of seconds on a few hundred detections.
 */
describe('SastIacUtilsService.getExistingVulnerabilities — set-based reads', () => {
  let utils: SastIacUtilsService;
  let sastRepo: any;
  let iacRepo: any;
  let histRepo: any;
  let correspondanceRepo: any;

  /** Catalogue vuln -> its enabled correspondances (scanner, ruleId). */
  const CATALOGUE: Record<
    string,
    Array<{ scanner: string; ruleId: string }>
  > = {
    'cat-a': [
      { scanner: 'checkov', ruleId: 'CKV_A' },
      { scanner: 'checkov', ruleId: 'BC_A' },
    ],
    'cat-b': [{ scanner: 'checkov', ruleId: 'CKV_B' }],
  };

  /** A correspondance read: `vulnerability.id` is a value or an IN list. */
  const findCorrespondances = async (opts: any) => {
    const wanted = opts?.where?.vulnerability?.id;
    const ids: string[] = Array.isArray(wanted?.value)
      ? wanted.value
      : [wanted];
    return ids.flatMap((id) =>
      (CATALOGUE[id] ?? []).map((c) => ({
        ...c,
        enabled: true,
        vulnerability: { id },
      })),
    );
  };

  const mk = <T>(cls: new () => T, id: string, catalogueId: string): T =>
    Object.assign(new cls(), {
      id,
      projectId: 'p1',
      branch: 'main',
      scannerType: 'checkov',
      currentState: 'to_verify',
      path: `${id}.tf`,
      vulnerableStartLine: 1,
      vulnerableEndLine: 1,
      codeSnippets: [],
      vulnerability: { id: catalogueId },
    });

  beforeEach(async () => {
    sastRepo = createMockRepository();
    sastRepo.find.mockResolvedValue([]);
    iacRepo = createMockRepository();
    iacRepo.find.mockResolvedValue([]);
    const cicdRepo: any = createMockRepository();
    cicdRepo.find.mockResolvedValue([]);
    histRepo = createMockRepository();
    histRepo.find.mockResolvedValue([]);
    histRepo.findOne.mockResolvedValue(null);
    correspondanceRepo = createMockRepository();
    correspondanceRepo.find.mockImplementation(findCorrespondances);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SastIacUtilsService,
        {
          provide: getRepositoryToken(CodeSnippet),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(DataFlowItem),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CorrespondanceTable),
          useValue: correspondanceRepo,
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: histRepo,
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: sastRepo,
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: iacRepo,
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: cicdRepo,
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        { provide: SastIacService, useValue: {} },
        { provide: ResultService, useValue: {} },
        { provide: IssueIntegrationService, useValue: {} },
        { provide: CvssCalculatorService, useValue: {} },
        { provide: Logger, useValue: createLoggerMock() },
        { provide: SecretEncryptionService, useValue: {} },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
      ],
    }).compile();
    utils = module.get(SastIacUtilsService);
  });

  const queriesFor = async (n: number) => {
    for (const repo of [histRepo, correspondanceRepo]) {
      repo.find.mockClear();
      repo.findOne.mockClear();
    }
    iacRepo.find.mockResolvedValue(
      Array.from({ length: n }, (_, i) =>
        mk(
          IacVulnerabilityDetections,
          `iac-${n}-${i}`,
          i % 2 ? 'cat-a' : 'cat-b',
        ),
      ),
    );
    await utils.getExistingVulnerabilities('p1', 'scan-2', 'checkov', 'main');
    return {
      historyFind: histRepo.find.mock.calls.length,
      historyFindOne: histRepo.findOne.mock.calls.length,
      correspondanceFind: correspondanceRepo.find.mock.calls.length,
    };
  };

  it('makes the same number of queries for 1 and for 50 detections', async () => {
    const one = await queriesFor(1);
    const fifty = await queriesFor(50);

    expect(fifty).toEqual(one);
    expect(fifty).toEqual({
      historyFind: 1,
      historyFindOne: 0,
      correspondanceFind: 1,
    });
  });

  it("reads the current scan's history by scanId and the correspondances of every catalogue vulnerability at once", async () => {
    iacRepo.find.mockResolvedValue([
      mk(IacVulnerabilityDetections, 'iac-1', 'cat-a'),
      mk(IacVulnerabilityDetections, 'iac-2', 'cat-b'),
      mk(IacVulnerabilityDetections, 'iac-3', 'cat-a'),
    ]);

    await utils.getExistingVulnerabilities('p1', 'scan-2', 'checkov', 'main');

    expect(histRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: sightingsWhere('scan-2') }),
    );
    const where = correspondanceRepo.find.mock.calls[0][0].where;
    expect(where.enabled).toBe(true);
    expect(where.vulnerability.id.type).toBe('in');
    // Each catalogue vulnerability once.
    expect([...where.vulnerability.id.value].sort()).toEqual([
      'cat-a',
      'cat-b',
    ]);
  });

  it('maps each detection under every rule of its catalogue vulnerability, in detection order', async () => {
    const a1 = mk(SastVulnerabilityDetections, 'sast-a1', 'cat-a');
    const b1 = mk(IacVulnerabilityDetections, 'iac-b1', 'cat-b');
    const a2 = mk(IacVulnerabilityDetections, 'iac-a2', 'cat-a');
    sastRepo.find.mockResolvedValue([a1]);
    iacRepo.find.mockResolvedValue([b1, a2]);

    const { existingVulnsMap } = await utils.getExistingVulnerabilities(
      'p1',
      'scan-2',
      'checkov',
      'main',
    );

    expect([...existingVulnsMap.keys()].sort()).toEqual([
      'checkov:BC_A',
      'checkov:CKV_A',
      'checkov:CKV_B',
    ]);
    // SAST first, then IaC, as the detections are listed: processVulnerability
    // takes the first match.
    expect(existingVulnsMap.get('checkov:CKV_A')).toEqual([a1, a2]);
    expect(existingVulnsMap.get('checkov:BC_A')).toEqual([a1, a2]);
    expect(existingVulnsMap.get('checkov:CKV_B')).toEqual([b1]);
  });

  it('leaves out a detection an earlier batch of this scan already matched', async () => {
    const seen = mk(IacVulnerabilityDetections, 'iac-seen', 'cat-a');
    const open = mk(IacVulnerabilityDetections, 'iac-open', 'cat-a');
    iacRepo.find.mockResolvedValue([seen, open]);
    histRepo.find.mockResolvedValue([
      { scanId: 'scan-2', iacVulnerabilityDetection: { id: 'iac-seen' } },
    ]);
    // The previous lookup, answered the same way, so this case would pass
    // with either implementation: it pins the behaviour, not the query.
    histRepo.findOne.mockImplementation(async (opts: any) =>
      opts?.where?.iacVulnerabilityDetection?.id === 'iac-seen'
        ? { scanId: 'scan-2' }
        : { scanId: 'scan-1' },
    );

    const { existingVulnsMap, existingIacVulns } =
      await utils.getExistingVulnerabilities('p1', 'scan-2', 'checkov', 'main');

    expect(existingVulnsMap.get('checkov:CKV_A')).toEqual([open]);
    // Still returned for the finalization, which decides on its own.
    expect(existingIacVulns).toEqual([seen, open]);
  });
});
