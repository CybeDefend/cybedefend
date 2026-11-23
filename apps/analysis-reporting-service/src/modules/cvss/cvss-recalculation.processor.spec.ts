import { CvssRecalculationProcessor } from './cvss-recalculation.processor';
import { CvssCalculatorService } from './cvss-calculator.service';
import { PriorityCalculatorService } from '../result/priority-calculator.service';
import { FindOperator, Repository } from 'typeorm';

describe('CvssRecalculationProcessor', () => {
  let processor: CvssRecalculationProcessor;
  let calculator: jest.Mocked<CvssCalculatorService>;
  let priorityCalculator: jest.Mocked<PriorityCalculatorService>;
  let sastRepo: jest.Mocked<Repository<any>>;
  let scaRepo: jest.Mocked<Repository<any>>;
  let containerRepo: jest.Mocked<Repository<any>>;

  beforeEach(() => {
    priorityCalculator = {
      calculate: jest
        .fn()
        .mockReturnValue({ priority: 'normal', compositeScore: 0.5 }),
      decompose: jest.fn(),
      computeContextModifier: jest.fn(),
    } as any;
    calculator = {
      applyEnvironmentalMetrics: jest.fn().mockReturnValue({
        fullVector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/AR:H',
        baseScore: 9.3,
        environmentalScore: 8.5,
      }),
      computeCvss4Base: jest.fn().mockReturnValue({
        vector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
        baseScore: 9.3,
      }),
      isSeverityDefaultVector: jest.fn().mockReturnValue(false),
    } as any;

    sastRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'det-1',
          cvss4Vector:
            'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
          cvss4EnvironmentalScore: 9.3,
        },
      ]),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    const makeEmptyRepo = () =>
      ({
        find: jest.fn().mockResolvedValue([]),
        save: jest.fn().mockResolvedValue(undefined),
        // EntityManager is shared across repos; the refresh resolves
        // VulnerabilityOsv (for container) via manager.find(VulnerabilityOsv, …)
        manager: { find: jest.fn().mockResolvedValue([]) },
      }) as any;

    scaRepo = makeEmptyRepo();
    containerRepo = makeEmptyRepo();
    const iacRepo = makeEmptyRepo();
    const secretRepo = makeEmptyRepo();
    const cicdRepo = makeEmptyRepo();

    processor = new CvssRecalculationProcessor(
      calculator,
      priorityCalculator,
      sastRepo,
      scaRepo, // sca
      iacRepo, // iac
      containerRepo, // container
      secretRepo, // secret
      cicdRepo, // cicd
    );
  });

  it('should recalculate environmental scores for detections with cvss4Vector', async () => {
    const context = {
      internetExposure: 'public',
      networkSegmentation: 'flat',
      environment: 'production',
      dataClassification: 'confidential',
      businessCriticality: 'high',
      handlesPii: false,
      handlesPaymentData: false,
      safetyCritical: false,
    };

    await processor.recalculateForProject('project-1', context);

    expect(calculator.applyEnvironmentalMetrics).toHaveBeenCalled();
    expect(sastRepo.save).toHaveBeenCalled();
  });

  it('should backfill cvss4Vector for detections with NULL vectors', async () => {
    const backfillDetection = {
      id: 'det-backfill',
      cvss4Vector: null,
      cvss4BaseScore: null,
      currentSeverity: 'HIGH',
      priorityManualOverride: false,
      vulnerability: {
        cvss3: {
          vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          baseScore: '9.8',
        },
      },
    };

    // First call: backfill query (IsNull) returns detection; subsequent calls return empty
    let callCount = 0;
    sastRepo.find.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [backfillDetection];
      return [];
    });

    const context = {
      internetExposure: 'public',
      networkSegmentation: 'flat',
      environment: 'production',
      dataClassification: 'confidential',
      businessCriticality: 'high',
      handlesPii: false,
      handlesPaymentData: false,
      safetyCritical: false,
    };

    await processor.recalculateForProject('project-1', context);

    // Verify computeCvss4Base was called for the backfill
    expect(calculator.computeCvss4Base).toHaveBeenCalled();
    // Verify the detection was saved with the CVSS4 data
    expect(sastRepo.save).toHaveBeenCalled();
    const savedDetections = sastRepo.save.mock.calls.find(
      (call) => call[0]?.[0]?.cvss4Vector || call[0]?.cvss4Vector,
    );
    expect(savedDetections).toBeTruthy();
  });

  it('forwards SCA scaDetectedPackage.reachability to priorityCalculator.calculate', async () => {
    // Build a SCA-only fixture: only the scaRepo returns a detection
    const scaDetection = {
      id: 'sca-recalc-1',
      cvss4Vector: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H',
      cvss4EnvironmentalScore: 9.0,
      cvss4BaseScore: 9.0,
      currentSeverity: 'CRITICAL',
      epssScore: 0.5,
      exploitabilityScore: 0.8,
      priorityManualOverride: false,
      scaDetectedPackage: { reachability: 'unused' },
    };

    const scaRepo = {
      // Only return the detection when the call requests scaDetectedPackage
      // AND the where clause looks like the recalculateRepo query (cvss4Vector
      // not null). Other calls (backfill phases) return empty.
      find: jest.fn().mockImplementation(async (opts: any) => {
        const wantsPackage = opts?.relations?.includes('scaDetectedPackage');
        const wantsRecalcRow =
          opts?.where?.cvss4Vector !== undefined &&
          opts?.where?.exploitabilityVerdict === undefined;
        if (wantsPackage && wantsRecalcRow && (opts.skip ?? 0) === 0) {
          return [scaDetection];
        }
        return [];
      }),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    const emptyRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    const localProcessor = new CvssRecalculationProcessor(
      calculator,
      priorityCalculator,
      emptyRepo, // sast
      scaRepo, // sca
      emptyRepo, // iac
      emptyRepo, // container
      emptyRepo, // secret
      emptyRepo, // cicd
    );

    const context = {
      internetExposure: 'public',
      networkSegmentation: 'flat',
      environment: 'production',
      dataClassification: 'confidential',
      businessCriticality: 'high',
      handlesPii: false,
      handlesPaymentData: false,
      safetyCritical: false,
    };

    await localProcessor.recalculateForProject('project-1', context);

    // At least one SCA find call must request the scaDetectedPackage relation
    // (recalculateRepo for SCA — backfill calls also fire but without relations)
    const findCallsWithPackage = scaRepo.find.mock.calls.filter((call: any[]) =>
      call[0]?.relations?.includes('scaDetectedPackage'),
    );
    expect(findCallsWithPackage.length).toBeGreaterThan(0);

    // priorityCalculator.calculate must have been invoked with reachability='unused'
    expect(priorityCalculator.calculate).toHaveBeenCalledWith(
      expect.objectContaining({ reachability: 'unused' }),
    );
  });

  it('should persist cvss4EnvironmentalVector after recalc', async () => {
    calculator.applyEnvironmentalMetrics.mockReturnValue({
      fullVector:
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/AR:H/MSC:H/MSA:H',
      baseScore: 9.3,
      environmentalScore: 9.7,
    });

    sastRepo.find.mockResolvedValue([
      {
        id: 'det-env-vec',
        cvss4Vector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
        cvss4EnvironmentalScore: null,
        cvss4EnvironmentalVector: null,
        currentSeverity: 'CRITICAL',
        priorityManualOverride: false,
      },
    ]);

    const context = {
      internetExposure: 'public',
      networkSegmentation: 'flat',
      environment: 'production',
      dataClassification: 'confidential',
      businessCriticality: 'high',
      handlesPii: false,
      handlesPaymentData: false,
      safetyCritical: false,
    };

    await processor.recalculateForProject('project-1', context);

    expect(sastRepo.save).toHaveBeenCalled();
    const savedBatch = sastRepo.save.mock.calls
      .map((call: any[]) => (Array.isArray(call[0]) ? call[0] : [call[0]]))
      .flat();
    const saved = savedBatch.find((d: any) => d.id === 'det-env-vec');
    expect(saved).toBeDefined();
    expect(saved.cvss4EnvironmentalVector).toBe(
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/AR:H/MSC:H/MSA:H',
    );
    expect(saved.cvss4EnvironmentalScore).toBe(9.7);
  });

  it('passes effectiveSeverity (not currentSeverity) to priorityCalculator when effectiveSeverity is freshly derived', async () => {
    // Detection has currentSeverity='high'.
    // applyEnvironmentalMetrics returns environmentalScore=9.4 → deriveEffectiveSeverity → 'critical'.
    // After recalculateRepo sets det.effectiveSeverity='critical', priorityCalculator
    // must receive currentSeverity='critical' (the effective), not 'high'.
    const det: any = {
      id: 'det-eff-fallback',
      cvss4Vector:
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
      currentSeverity: 'high',
      effectiveSeverity: null,
      cvss4BaseScore: null,
      cvss4EnvironmentalScore: null,
      cvss4EnvironmentalVector: null,
      priorityManualOverride: false,
      epssScore: null,
      epssPercentile: null,
      exploitabilityScore: null,
    };

    // applyEnvironmentalMetrics returns a score >=9.0 → deriveEffectiveSeverity='critical'
    const localCalculator = {
      isSeverityDefaultVector: jest.fn().mockReturnValue(false),
      applyEnvironmentalMetrics: jest.fn().mockReturnValue({
        fullVector: det.cvss4Vector,
        baseScore: 7.2,
        environmentalScore: 9.4, // >= 9.0 → 'critical'
      }),
      computeCvss4Base: jest.fn().mockReturnValue(null),
    } as any;

    const localSastRepo = {
      // Phase order: backfillFromVulnerabilityCvss3, backfillExploitabilityForRepo,
      // backfillMissingEffectiveSeverity, then recalculateRepo
      find: jest
        .fn()
        .mockResolvedValueOnce([]) // backfill cvss4 vectors
        .mockResolvedValueOnce([]) // backfill exploitability
        .mockResolvedValueOnce([]) // backfill effectiveSeverity
        .mockResolvedValueOnce([det]) // recalculateRepo — returns the detection
        .mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    const emptyRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    const localPriorityCalc = {
      calculate: jest
        .fn()
        .mockReturnValue({ priority: 'critical', priorityScore: 0.95 }),
    } as any;

    const localProcessor = new CvssRecalculationProcessor(
      localCalculator,
      localPriorityCalc,
      localSastRepo,
      emptyRepo, // sca
      emptyRepo, // iac
      emptyRepo, // container
      emptyRepo, // secret
      emptyRepo, // cicd
    );

    const context = {
      internetExposure: 'public',
      networkSegmentation: 'flat',
      environment: 'production',
      dataClassification: 'confidential',
      businessCriticality: 'high',
      handlesPii: false,
      handlesPaymentData: false,
      safetyCritical: false,
    };

    await localProcessor.recalculateForProject('project-eff', context);

    // effectiveSeverity was set to 'critical' by deriveEffectiveSeverity(9.4, 7.2)
    // so priorityCalculator must receive 'critical' (effective), not 'high' (current)
    expect(localPriorityCalc.calculate).toHaveBeenCalledWith(
      expect.objectContaining({ currentSeverity: 'critical' }),
    );
  });

  it('falls back to currentSeverity when effectiveSeverity is null (no CVSS4 env score)', async () => {
    // Detection has currentSeverity='medium' and no CVSS4 data.
    // applyEnvironmentalMetrics returns null → no effectiveSeverity set.
    // priorityCalculator must receive currentSeverity='medium'.
    const det: any = {
      id: 'det-no-cvss4',
      cvss4Vector:
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
      currentSeverity: 'medium',
      effectiveSeverity: null,
      cvss4BaseScore: null,
      cvss4EnvironmentalScore: null,
      cvss4EnvironmentalVector: null,
      priorityManualOverride: false,
      epssScore: null,
      epssPercentile: null,
      exploitabilityScore: null,
    };

    // applyEnvironmentalMetrics returns null scores → deriveEffectiveSeverity returns null
    const localCalculator = {
      isSeverityDefaultVector: jest.fn().mockReturnValue(false),
      applyEnvironmentalMetrics: jest.fn().mockReturnValue({
        fullVector: det.cvss4Vector,
        baseScore: null,
        environmentalScore: null, // null → effectiveSeverity stays null
      }),
      computeCvss4Base: jest.fn().mockReturnValue(null),
    } as any;

    const localSastRepo = {
      find: jest
        .fn()
        .mockResolvedValueOnce([]) // backfill cvss4 vectors
        .mockResolvedValueOnce([]) // backfill exploitability
        .mockResolvedValueOnce([]) // backfill effectiveSeverity
        .mockResolvedValueOnce([det]) // recalculateRepo
        .mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    const emptyRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    const localPriorityCalc = {
      calculate: jest
        .fn()
        .mockReturnValue({ priority: 'normal', priorityScore: 0.5 }),
    } as any;

    const localProcessor = new CvssRecalculationProcessor(
      localCalculator,
      localPriorityCalc,
      localSastRepo,
      emptyRepo,
      emptyRepo,
      emptyRepo,
      emptyRepo,
      emptyRepo,
    );

    await localProcessor.recalculateForProject('project-fallback', {} as any);

    // effectiveSeverity is null → fall back to currentSeverity='medium'
    expect(localPriorityCalc.calculate).toHaveBeenCalledWith(
      expect.objectContaining({ currentSeverity: 'medium' }),
    );
  });

  it('should skip detections without cvss4Vector when backfill cannot produce one', async () => {
    // computeCvss4Base returns null → backfill cannot produce a vector
    calculator.computeCvss4Base.mockReturnValue(null);

    sastRepo.find.mockResolvedValue([
      {
        id: 'det-2',
        cvss4Vector: null,
        cvss4EnvironmentalScore: null,
        currentSeverity: 'LOW',
      },
    ]);

    const context = {
      internetExposure: 'public',
      networkSegmentation: 'flat',
      environment: 'production',
      dataClassification: 'public',
      businessCriticality: 'low',
      handlesPii: false,
      handlesPaymentData: false,
      safetyCritical: false,
    };

    await processor.recalculateForProject('project-1', context);

    expect(calculator.applyEnvironmentalMetrics).not.toHaveBeenCalled();
  });

  it('sets effectiveSeverity from env score after recalc', async () => {
    const det: any = {
      id: 'det-eff-sev',
      cvss4Vector:
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
      currentSeverity: 'high',
      effectiveSeverity: null,
      cvss4BaseScore: 7.2,
      cvss4EnvironmentalScore: null,
      cvss4EnvironmentalVector: null,
      priorityManualOverride: false,
      epssScore: null,
      epssPercentile: null,
      exploitabilityScore: null,
    };

    const localCalculator = {
      isSeverityDefaultVector: jest.fn().mockReturnValue(false),
      applyEnvironmentalMetrics: jest.fn().mockReturnValue({
        fullVector: det.cvss4Vector,
        baseScore: 7.2,
        environmentalScore: 9.4,
      }),
      computeCvss4Base: jest.fn().mockReturnValue(null),
    } as any;

    const localPriorityCalc = {
      calculate: jest
        .fn()
        .mockReturnValue({ priority: 'critical', priorityScore: 0.95 }),
    } as any;

    // Returns empty for all backfill phases, then returns det for recalculateRepo on sast
    const localSastRepo = {
      find: jest
        .fn()
        .mockResolvedValueOnce([]) // backfillFromVulnerabilityCvss3 pass 1
        .mockResolvedValueOnce([]) // backfillExploitabilityForRepo pass 1
        .mockResolvedValueOnce([]) // backfillMissingEffectiveSeverity pass 1
        .mockResolvedValueOnce([det]) // recalculateRepo pass 1
        .mockResolvedValue([]), // all further calls → empty (stop loops)
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    const emptyRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    const localProcessor = new CvssRecalculationProcessor(
      localCalculator,
      localPriorityCalc,
      localSastRepo, // sast
      emptyRepo, // sca
      emptyRepo, // iac
      emptyRepo, // container
      emptyRepo, // secret
      emptyRepo, // cicd
    );

    await localProcessor.recalculateForProject('p1', {} as any);

    expect(det.effectiveSeverity).toBe('critical');
  });

  it('re-queues rows without cvss4Vector through backfillMissingCvss4Vectors AFTER recalculateRepo', async () => {
    // Bug repro: 3 SAST rows — 2 WITH vecteur (processed by recalculateRepo),
    // 1 SANS vecteur. The 3rd row must also have its priorityScore refreshed
    // AFTER the recalc pass completes, via a post-recalc backfill re-queue.
    //
    // Before fix: backfillMissingCvss4Vectors runs ONCE at step 1 (before
    // recalculateRepo). If a row still has null vector after step 1, no
    // further attempt is made → priorityScore stays stale.
    //
    // After fix: backfillMissingCvss4Vectors must also be called AFTER
    // recalculateRepo as a safe-side re-queue. We assert the call ordering
    // using mock.invocationCallOrder.

    const withVector1: any = {
      id: 'det-with-1',
      cvss4Vector:
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
      cvss4BaseScore: 8.0,
      cvss4EnvironmentalScore: 8.0,
      currentSeverity: 'HIGH',
      effectiveSeverity: 'high',
      priorityManualOverride: false,
      epssScore: null,
      epssPercentile: null,
      exploitabilityScore: null,
    };
    const withVector2: any = {
      id: 'det-with-2',
      cvss4Vector:
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
      cvss4BaseScore: 7.5,
      cvss4EnvironmentalScore: 7.5,
      currentSeverity: 'HIGH',
      effectiveSeverity: 'high',
      priorityManualOverride: false,
      epssScore: null,
      epssPercentile: null,
      exploitabilityScore: null,
    };
    const withoutVector: any = {
      id: 'det-without',
      cvss4Vector: null,
      cvss4BaseScore: null,
      cvss4EnvironmentalScore: null,
      currentSeverity: 'HIGH',
      effectiveSeverity: null,
      priorityManualOverride: false,
      vulnerability: {
        cvss3: {
          vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          baseScore: '9.8',
        },
      },
    };

    // The repo must distinguish between backfill (cvss4Vector IsNull) and
    // recalc (cvss4Vector Not IsNull) queries. We inspect the `_type` of the
    // FindOperator to tell them apart.
    const localSastRepo: any = {
      find: jest.fn().mockImplementation(async (opts: any) => {
        const where = opts?.where ?? {};
        const cvssClause = where.cvss4Vector;
        const exploitClause = where.exploitabilityVerdict;
        const effSevClause = where.effectiveSeverity;
        const skip = opts?.skip ?? 0;

        // Helper: inspect TypeORM FindOperator type (isNull vs not)
        const isNullClause = cvssClause && cvssClause._type === 'isNull';
        const notNullClause =
          cvssClause &&
          cvssClause._type === 'not' &&
          cvssClause._value?._type === 'isNull';

        // Backfill exploitability pass
        if (exploitClause) return [];
        // Backfill effectiveSeverity pass
        if (effSevClause) return [];

        // Backfill cvss4Vector pass (IsNull)
        if (isNullClause) {
          if (skip === 0 && withoutVector.cvss4Vector == null) {
            return [withoutVector];
          }
          return [];
        }

        // recalculateRepo pass (Not(IsNull))
        if (notNullClause) {
          if (skip === 0) {
            return [withVector1, withVector2, withoutVector].filter(
              (r) => r.cvss4Vector != null,
            );
          }
          return [];
        }
        return [];
      }),
      save: jest.fn().mockResolvedValue(undefined),
    };

    const emptyRepo: any = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    };

    const localCalculator: any = {
      isSeverityDefaultVector: jest.fn().mockReturnValue(false),
      applyEnvironmentalMetrics: jest.fn().mockReturnValue({
        fullVector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/AR:H',
        baseScore: 9.3,
        environmentalScore: 8.5,
      }),
      // When called from backfillFromVulnerabilityCvss3, produce a vector
      // for the row without vector so it becomes eligible for priority save
      computeCvss4Base: jest.fn().mockImplementation(() => {
        withoutVector.cvss4Vector =
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
        withoutVector.cvss4BaseScore = 9.3;
        return {
          vector:
            'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
          baseScore: 9.3,
        };
      }),
    };

    const localPriorityCalc: any = {
      calculate: jest
        .fn()
        .mockReturnValue({ priority: 'high', priorityScore: 0.78 }),
    };

    const localProcessor = new CvssRecalculationProcessor(
      localCalculator,
      localPriorityCalc,
      localSastRepo,
      emptyRepo, // sca
      emptyRepo, // iac
      emptyRepo, // container
      emptyRepo, // secret
      emptyRepo, // cicd
    );

    // Spy on backfillMissingCvss4Vectors to count invocations and capture order
    const backfillSpy = jest.spyOn(
      localProcessor,
      'backfillMissingCvss4Vectors',
    );

    const context = {
      internetExposure: 'public',
      networkSegmentation: 'flat',
      environment: 'production',
      dataClassification: 'confidential',
      businessCriticality: 'high',
      handlesPii: false,
      handlesPaymentData: false,
      safetyCritical: false,
    } as any;

    await localProcessor.recalculateForProject('project-requeue', context);

    // Rows with vector must have been processed by recalculateRepo
    expect(localCalculator.applyEnvironmentalMetrics).toHaveBeenCalled();

    // Bug fix assertion: backfillMissingCvss4Vectors must be invoked AT LEAST
    // TWICE — once at step 1 (before recalc) and once AFTER recalculateRepo
    // as a safety re-queue for rows that did not have a vector on the first
    // pass.
    expect(backfillSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    // The LAST backfillMissingCvss4Vectors invocation must happen AFTER all
    // recalc saves on the sastRepo — i.e., it is a post-recalc re-queue.
    const lastBackfillOrder =
      backfillSpy.mock.invocationCallOrder[
        backfillSpy.mock.invocationCallOrder.length - 1
      ];
    const saveOrders = localSastRepo.save.mock.invocationCallOrder;
    const maxSaveOrder = Math.max(...saveOrders);
    expect(lastBackfillOrder).toBeGreaterThan(maxSaveOrder);
  });

  describe('refreshCvssFromOsv — re-derive CVSS from changed OSV severities', () => {
    const context = {
      internetExposure: 'public',
      networkSegmentation: 'flat',
      environment: 'production',
      dataClassification: 'confidential',
      businessCriticality: 'high',
      handlesPii: false,
      handlesPaymentData: false,
      safetyCritical: false,
    };
    const NEW_CVSS4 =
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';

    it('re-derives an SCA detection CVSS from the changed OSV severities (env score refreshed)', async () => {
      const det: any = {
        id: 'sca-1',
        projectId: 'p1',
        priorityManualOverride: false,
        currentSeverity: 'HIGH',
        cvss4Vector: 'OLD',
        cvss4BaseScore: 7.0,
        cvss4EnvironmentalScore: 6.0,
        cvss4EnvironmentalVector: 'OLDENV',
        effectiveSeverity: 'medium',
        scaDetectedPackage: { reachability: null },
        vulnerability: {
          id: 'CVE-1',
          severities: [{ type: 'CVSS_V4', score: NEW_CVSS4 }],
        },
      };
      scaRepo.find.mockResolvedValueOnce([det]).mockResolvedValue([]);

      const n = await processor.refreshCvssFromOsv('p1', ['CVE-1'], context);

      expect(calculator.computeCvss4Base).toHaveBeenCalled();
      expect(calculator.applyEnvironmentalMetrics).toHaveBeenCalled();
      expect(scaRepo.save).toHaveBeenCalled();
      expect(det.cvss4EnvironmentalScore).toBe(8.5);
      expect(n).toBeGreaterThanOrEqual(1);
    });

    it('re-derives a container detection CVSS via OSV lookup by vulnerabilityIdentifier', async () => {
      const det: any = {
        id: 'c-1',
        projectId: 'p1',
        priorityManualOverride: false,
        currentSeverity: 'MEDIUM',
        vulnerabilityIdentifier: 'CVE-2',
        cvss4Vector: 'OLD',
        cvss4BaseScore: 5,
        cvss4EnvironmentalScore: 5,
        cvss4EnvironmentalVector: 'OLD',
        effectiveSeverity: 'medium',
      };
      containerRepo.find.mockResolvedValueOnce([det]).mockResolvedValue([]);
      (containerRepo.manager.find as jest.Mock).mockResolvedValue([
        { id: 'CVE-2', severities: [{ type: 'CVSS_V4', score: NEW_CVSS4 }] },
      ]);

      const n = await processor.refreshCvssFromOsv('p1', ['CVE-2'], context);

      expect(containerRepo.save).toHaveBeenCalled();
      expect(det.cvss4EnvironmentalScore).toBe(8.5);
      expect(n).toBeGreaterThanOrEqual(1);
    });

    it('leaves a detection untouched when the OSV has no concrete CVSS_V4/V3 vector (no downgrade to a label default)', async () => {
      const det: any = {
        id: 'sca-2',
        projectId: 'p1',
        priorityManualOverride: false,
        currentSeverity: 'HIGH',
        cvss4Vector: 'PKG-SPECIFIC',
        cvss4BaseScore: 7,
        cvss4EnvironmentalScore: 6,
        cvss4EnvironmentalVector: 'ENV',
        effectiveSeverity: 'high',
        scaDetectedPackage: { reachability: null },
        vulnerability: {
          id: 'CVE-3',
          severities: [{ type: 'DATABASE_SPECIFIC', score: 'HIGH' }],
        },
      };
      scaRepo.find.mockResolvedValueOnce([det]).mockResolvedValue([]);

      const n = await processor.refreshCvssFromOsv('p1', ['CVE-3'], context);

      expect(scaRepo.save).not.toHaveBeenCalled();
      expect(det.cvss4Vector).toBe('PKG-SPECIFIC');
      expect(n).toBe(0);
    });
  });
});

describe('CvssRecalculationProcessor – backfillMissingExploitability', () => {
  let proc: CvssRecalculationProcessor;
  let scaRepo: jest.Mocked<Repository<any>>;
  let sastRepo2: jest.Mocked<Repository<any>>;
  let emptyRepo: jest.Mocked<Repository<any>>;

  beforeEach(() => {
    emptyRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    scaRepo = {
      find: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'sca-1',
            exploitabilityVerdict: null,
            exploitabilitySource: null,
            cvss4BaseScore: 9.0,
            cvss4EnvironmentalScore: null,
            currentSeverity: 'CRITICAL',
            epssScore: null,
            scaDetectedPackage: {
              isDev: false,
              isTransitive: false,
              reachability: 'used',
              dependencyInfoAvailable: true,
            },
          },
        ])
        .mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    sastRepo2 = {
      find: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'sast-1',
            exploitabilityVerdict: null,
            exploitabilitySource: null,
            cvss4BaseScore: 7.5,
            cvss4EnvironmentalScore: null,
            currentSeverity: 'HIGH',
            epssScore: null,
          },
        ])
        .mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    const mockCalculator = {
      isSeverityDefaultVector: jest.fn().mockReturnValue(false),
      applyEnvironmentalMetrics: jest.fn(),
      computeCvss4Base: jest.fn(),
    } as any;
    const mockPriorityCalc = {
      calculate: jest.fn().mockReturnValue({ priority: 'normal' }),
    } as any;

    proc = new CvssRecalculationProcessor(
      mockCalculator,
      mockPriorityCalc,
      sastRepo2, // sast
      scaRepo, // sca
      emptyRepo, // iac
      emptyRepo, // container
      emptyRepo, // secret
      emptyRepo, // cicd
    );
  });

  it('sets verdict=proven and source=static for direct non-dev SCA detection with reachability=used', async () => {
    const count = await proc.backfillMissingExploitability('proj-1');

    expect(count).toBeGreaterThanOrEqual(1);
    expect(scaRepo.save).toHaveBeenCalled();
    const saved = (scaRepo.save.mock.calls[0][0] as any[])[0];
    expect(saved.exploitabilitySource).toBe('static');
    expect(saved.exploitabilityVerdict).toBe('proven');
    expect(saved.exploitabilityScore).toBe(0.75);
  });

  it('does NOT overwrite a detection that already has a verdict', async () => {
    scaRepo.find.mockReset();
    scaRepo.find
      .mockResolvedValueOnce([
        {
          id: 'sca-existing',
          exploitabilityVerdict: 'proven',
          exploitabilitySource: 'agent',
          cvss4BaseScore: 8.0,
          cvss4EnvironmentalScore: null,
          currentSeverity: 'HIGH',
          epssScore: null,
          scaDetectedPackage: { reachability: null },
        },
      ])
      .mockResolvedValue([]);

    await proc.backfillMissingExploitability('proj-1');

    expect(scaRepo.save).not.toHaveBeenCalled();
  });

  it('seeds cvss4EnvironmentalScore = cvss4BaseScore when env is null', async () => {
    await proc.backfillMissingExploitability('proj-1');
    const saved = (scaRepo.save.mock.calls[0][0] as any[])[0];
    expect(saved.cvss4EnvironmentalScore).toBe(9.0);
  });

  it('isDev=true on SCA detection → not_exploitable regardless of severity/CVSS', async () => {
    scaRepo.find.mockReset();
    scaRepo.find
      .mockResolvedValueOnce([
        {
          id: 'sca-dev',
          exploitabilityVerdict: null,
          exploitabilitySource: null,
          cvss4BaseScore: 9.8,
          cvss4EnvironmentalScore: null,
          currentSeverity: 'CRITICAL',
          epssScore: null,
          scaDetectedPackage: {
            isDev: true,
            isTransitive: false,
            reachability: 'used',
            dependencyInfoAvailable: true,
          },
        },
      ])
      .mockResolvedValue([]);

    await proc.backfillMissingExploitability('proj-1');

    const saved = (scaRepo.save.mock.calls[0][0] as any[])[0];
    expect(saved.exploitabilityVerdict).toBe('not_exploitable');
    expect(saved.exploitabilityScore).toBe(0.05);
  });

  it('isTransitive=true on SCA detection → theoretical', async () => {
    scaRepo.find.mockReset();
    scaRepo.find
      .mockResolvedValueOnce([
        {
          id: 'sca-transitive',
          exploitabilityVerdict: null,
          exploitabilitySource: null,
          cvss4BaseScore: 9.0,
          cvss4EnvironmentalScore: null,
          currentSeverity: 'CRITICAL',
          epssScore: null,
          scaDetectedPackage: {
            isDev: false,
            isTransitive: true,
            reachability: 'used',
            dependencyInfoAvailable: true,
          },
        },
      ])
      .mockResolvedValue([]);

    await proc.backfillMissingExploitability('proj-1');

    const saved = (scaRepo.save.mock.calls[0][0] as any[])[0];
    expect(saved.exploitabilityVerdict).toBe('theoretical');
    expect(saved.exploitabilityScore).toBe(0.35);
  });

  it('direct non-dev package with reachability=null → theoretical (no import proof)', async () => {
    scaRepo.find.mockReset();
    scaRepo.find
      .mockResolvedValueOnce([
        {
          id: 'sca-direct-unused',
          exploitabilityVerdict: null,
          exploitabilitySource: null,
          cvss4BaseScore: 9.0,
          cvss4EnvironmentalScore: null,
          currentSeverity: 'CRITICAL',
          epssScore: null,
          scaDetectedPackage: {
            isDev: false,
            isTransitive: false,
            reachability: null,
            dependencyInfoAvailable: true,
          },
        },
      ])
      .mockResolvedValue([]);

    await proc.backfillMissingExploitability('proj-1');
    const saved = (scaRepo.save.mock.calls[0][0] as any[])[0];
    expect(saved.exploitabilityVerdict).toBe('theoretical');
    expect(saved.exploitabilityScore).toBe(0.35);
  });

  it('dependencyInfoAvailable=false does not override the final SCA decision table', async () => {
    scaRepo.find.mockReset();
    scaRepo.find
      .mockResolvedValueOnce([
        {
          id: 'sca-syft-only',
          exploitabilityVerdict: null,
          exploitabilitySource: null,
          cvss4BaseScore: 9.0,
          cvss4EnvironmentalScore: null,
          currentSeverity: 'CRITICAL',
          epssScore: null,
          scaDetectedPackage: {
            isDev: false,
            isTransitive: false,
            reachability: 'used',
            dependencyInfoAvailable: false,
          },
        },
      ])
      .mockResolvedValue([]);

    await proc.backfillMissingExploitability('proj-1');
    const saved = (scaRepo.save.mock.calls[0][0] as any[])[0];
    expect(saved.exploitabilityVerdict).toBe('proven');
    expect(saved.exploitabilityScore).toBe(0.75);
  });
});

describe('CvssRecalculationProcessor – reevaluateScaStaticExploitability', () => {
  let proc: CvssRecalculationProcessor;
  let scaRepo: jest.Mocked<Repository<any>>;
  let emptyRepo: jest.Mocked<Repository<any>>;

  beforeEach(() => {
    emptyRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    scaRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    const mockCalculator = {
      isSeverityDefaultVector: jest.fn().mockReturnValue(false),
      applyEnvironmentalMetrics: jest.fn(),
      computeCvss4Base: jest.fn(),
    } as any;
    const mockPriorityCalc = {
      calculate: jest.fn().mockReturnValue({ priority: 'normal' }),
    } as any;

    proc = new CvssRecalculationProcessor(
      mockCalculator,
      mockPriorityCalc,
      emptyRepo, // sast
      scaRepo, // sca
      emptyRepo, // iac
      emptyRepo, // container
      emptyRepo, // secret
      emptyRepo, // cicd
    );
  });

  it('flips stale theoretical → not_exploitable for static SCA detection on unused package', async () => {
    scaRepo.find
      .mockResolvedValueOnce([
        {
          id: 'sca-stale-theoretical',
          exploitabilityVerdict: 'theoretical',
          exploitabilityScore: 0.35,
          exploitabilityReason: 'Static analysis: transitive dependency …',
          exploitabilitySource: 'static',
          exploitabilityUpdatedAt: new Date('2026-04-27T10:00:00Z'),
          scaDetectedPackage: {
            isDev: false,
            isTransitive: false,
            reachability: 'unused',
            dependencyInfoAvailable: true,
          },
        },
      ])
      .mockResolvedValue([]);

    const updated = await proc.reevaluateScaStaticExploitability('proj-1');

    expect(updated).toBe(1);
    expect(scaRepo.save).toHaveBeenCalledTimes(1);
    const saved = (scaRepo.save.mock.calls[0][0] as any[])[0];
    expect(saved.exploitabilityVerdict).toBe('not_exploitable');
    expect(saved.exploitabilityScore).toBe(0.05);
    expect(saved.exploitabilitySource).toBe('static');
    expect(saved.exploitabilityReason.toLowerCase()).toContain('unused');
    expect(saved.exploitabilityUpdatedAt.getTime()).toBeGreaterThan(
      new Date('2026-04-27T10:00:00Z').getTime(),
    );
  });

  it('does NOT touch detections where exploitabilitySource is agent', async () => {
    scaRepo.find.mockReset();
    scaRepo.find.mockResolvedValue([]);

    const updated = await proc.reevaluateScaStaticExploitability('proj-1');

    expect(updated).toBe(0);
    expect(scaRepo.save).not.toHaveBeenCalled();
    const findArgs = scaRepo.find.mock.calls[0][0] as any;
    expect(findArgs.where.exploitabilitySource).toBe('static');
  });

  it('is idempotent — does not save when verdict already matches the rule', async () => {
    scaRepo.find
      .mockResolvedValueOnce([
        {
          id: 'sca-already-correct',
          exploitabilityVerdict: 'not_exploitable',
          exploitabilityScore: 0.05,
          exploitabilityReason:
            'Static analysis: dependency is not reachable from any production code path (unused).',
          exploitabilitySource: 'static',
          exploitabilityUpdatedAt: new Date('2026-04-29T10:00:00Z'),
          scaDetectedPackage: {
            isDev: false,
            isTransitive: false,
            reachability: 'unused',
            dependencyInfoAvailable: true,
          },
        },
      ])
      .mockResolvedValue([]);

    const updated = await proc.reevaluateScaStaticExploitability('proj-1');

    expect(updated).toBe(0);
    expect(scaRepo.save).not.toHaveBeenCalled();
  });

  it('flips stale theoretical → proven when reachability switches to used', async () => {
    scaRepo.find
      .mockResolvedValueOnce([
        {
          id: 'sca-now-used',
          exploitabilityVerdict: 'theoretical',
          exploitabilityScore: 0.35,
          exploitabilityReason: 'Static analysis: …',
          exploitabilitySource: 'static',
          exploitabilityUpdatedAt: new Date('2026-04-27T10:00:00Z'),
          scaDetectedPackage: {
            isDev: false,
            isTransitive: false,
            reachability: 'used',
            dependencyInfoAvailable: true,
          },
        },
      ])
      .mockResolvedValue([]);

    const updated = await proc.reevaluateScaStaticExploitability('proj-1');

    expect(updated).toBe(1);
    const saved = (scaRepo.save.mock.calls[0][0] as any[])[0];
    expect(saved.exploitabilityVerdict).toBe('proven');
    expect(saved.exploitabilityScore).toBe(0.75);
  });

  it('skips detections without scaDetectedPackage relation (defensive)', async () => {
    scaRepo.find
      .mockResolvedValueOnce([
        {
          id: 'sca-orphan',
          exploitabilityVerdict: 'theoretical',
          exploitabilityScore: 0.35,
          exploitabilitySource: 'static',
          scaDetectedPackage: null,
        },
      ])
      .mockResolvedValue([]);

    const updated = await proc.reevaluateScaStaticExploitability('proj-1');

    expect(updated).toBe(0);
    expect(scaRepo.save).not.toHaveBeenCalled();
  });
});

describe('CvssRecalculationProcessor – backfillMissingEffectiveSeverity', () => {
  let proc: CvssRecalculationProcessor;
  let sastRepo: jest.Mocked<Repository<any>>;
  let scaRepo: jest.Mocked<Repository<any>>;
  let iacRepo: jest.Mocked<Repository<any>>;
  let containerRepo: jest.Mocked<Repository<any>>;
  let secretRepo: jest.Mocked<Repository<any>>;
  let cicdRepo: jest.Mocked<Repository<any>>;

  beforeEach(() => {
    const makeEmptyRepo = () =>
      ({
        find: jest.fn().mockResolvedValue([]),
        save: jest.fn().mockResolvedValue(undefined),
      }) as any;

    sastRepo = makeEmptyRepo();
    scaRepo = makeEmptyRepo();
    iacRepo = makeEmptyRepo();
    containerRepo = makeEmptyRepo();
    secretRepo = makeEmptyRepo();
    cicdRepo = makeEmptyRepo();

    const mockCalculator = {
      isSeverityDefaultVector: jest.fn().mockReturnValue(false),
      applyEnvironmentalMetrics: jest.fn(),
      computeCvss4Base: jest.fn(),
    } as any;
    const mockPriorityCalc = {
      calculate: jest.fn().mockReturnValue({ priority: 'normal' }),
    } as any;

    proc = new CvssRecalculationProcessor(
      mockCalculator,
      mockPriorityCalc,
      sastRepo,
      scaRepo,
      iacRepo,
      containerRepo,
      secretRepo,
      cicdRepo,
    );
  });

  it('backfillMissingEffectiveSeverity fills rows with CVSS4 scores only', async () => {
    const det1: any = {
      effectiveSeverity: null,
      cvss4EnvironmentalScore: 9.4,
      cvss4BaseScore: 7.0,
    };
    const det2: any = {
      effectiveSeverity: null,
      cvss4EnvironmentalScore: null,
      cvss4BaseScore: 5.5,
    };
    const det3: any = {
      effectiveSeverity: null,
      cvss4EnvironmentalScore: null,
      cvss4BaseScore: null,
    };

    sastRepo.find
      .mockResolvedValueOnce([det1, det2, det3])
      .mockResolvedValueOnce([]);

    await proc.backfillMissingEffectiveSeverity('p1');

    expect(det1.effectiveSeverity).toBe('critical');
    expect(det2.effectiveSeverity).toBe('medium');
    expect(det3.effectiveSeverity).toBeNull();
  });

  it('backfillMissingEffectiveSeverity returns count of updated rows', async () => {
    const det1: any = {
      effectiveSeverity: null,
      cvss4EnvironmentalScore: 9.4,
      cvss4BaseScore: 7.0,
    };
    const det2: any = {
      effectiveSeverity: null,
      cvss4EnvironmentalScore: null,
      cvss4BaseScore: 5.5,
    };
    const det3: any = {
      effectiveSeverity: null,
      cvss4EnvironmentalScore: null,
      cvss4BaseScore: null,
    };

    sastRepo.find
      .mockResolvedValueOnce([det1, det2, det3])
      .mockResolvedValueOnce([]);

    const updated = await proc.backfillMissingEffectiveSeverity('p1');

    expect(updated).toBe(2);
  });
});

describe('CvssRecalculationProcessor – context enum mappers', () => {
  let proc: CvssRecalculationProcessor;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    const emptyRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;
    const mockCalculator = {
      isSeverityDefaultVector: jest.fn().mockReturnValue(false),
      applyEnvironmentalMetrics: jest.fn(),
      computeCvss4Base: jest.fn(),
    } as any;
    const mockPriorityCalc = {
      calculate: jest.fn(),
    } as any;

    proc = new CvssRecalculationProcessor(
      mockCalculator,
      mockPriorityCalc,
      emptyRepo,
      emptyRepo,
      emptyRepo,
      emptyRepo,
      emptyRepo,
      emptyRepo,
    );
    warnSpy = jest
      .spyOn((proc as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('mapBusinessCriticality', () => {
    it.each([
      ['low', 1],
      ['medium', 2],
      ['high', 3],
      ['mission_critical', 4],
      ['HIGH', 3],
    ])('maps %s -> %i without warning', (input, expected) => {
      const value = (proc as any).mapBusinessCriticality(input);
      expect(value).toBe(expected);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('returns 0 (UNSPECIFIED) for an unknown value AND logs a warning', () => {
      const value = (proc as any).mapBusinessCriticality('very_high');
      expect(value).toBe(0);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(
        /businessCriticality.*very_high/i,
      );
    });

    it('returns 0 silently for null/undefined (treated as UNSPECIFIED)', () => {
      const v1 = (proc as any).mapBusinessCriticality(null);
      const v2 = (proc as any).mapBusinessCriticality(undefined);
      expect(v1).toBe(0);
      expect(v2).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('mapDataClassification', () => {
    it.each([
      ['public', 1],
      ['internal', 2],
      ['confidential', 3],
      ['regulated', 4],
      ['REGULATED', 4],
    ])('maps %s -> %i without warning', (input, expected) => {
      const value = (proc as any).mapDataClassification(input);
      expect(value).toBe(expected);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('returns 0 (UNSPECIFIED) for an unknown value AND logs a warning', () => {
      const value = (proc as any).mapDataClassification('top_secret');
      expect(value).toBe(0);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(
        /dataClassification.*top_secret/i,
      );
    });

    it('returns 0 silently for null/undefined (treated as UNSPECIFIED)', () => {
      const v1 = (proc as any).mapDataClassification(null);
      const v2 = (proc as any).mapDataClassification(undefined);
      expect(v1).toBe(0);
      expect(v2).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});

describe('CvssRecalculationProcessor – keyset pagination', () => {
  // Verifies that pagination uses WHERE id > lastId (keyset) instead of
  // OFFSET/skip. Keyset pagination is O(n) on 100k+ rows; skip/take is O(n²)
  // because the DB must re-count every previous page on each query.
  //
  // Assertions:
  //   1. No call ever uses `skip` (to catch regressions back to OFFSET).
  //   2. Pages after the first must include MoreThan(lastId) on `id`.
  //   3. All calls must be ordered by `id` ASC (required by keyset).
  const BATCH_SIZE = 500;

  function makePage(idPrefix: string, count: number, indexStart = 0): any[] {
    return Array.from({ length: count }).map((_, i) => ({
      id: `${idPrefix}-${String(indexStart + i).padStart(6, '0')}`,
      projectId: 'proj-keyset',
      cvss4EnvironmentalScore: 8.0,
      cvss4BaseScore: 8.0,
      currentSeverity: 'high',
      effectiveSeverity: 'high',
      epssScore: null,
      epssPercentile: null,
      exploitabilityScore: null,
      priorityManualOverride: false,
      currentPriority: 'normal',
      priorityScore: 0.4,
    }));
  }

  function buildProcessor() {
    const calculator = {
      isSeverityDefaultVector: jest.fn().mockReturnValue(false),
      applyEnvironmentalMetrics: jest.fn(),
      computeCvss4Base: jest.fn(),
    } as any;
    const priorityCalculator = {
      calculate: jest
        .fn()
        .mockReturnValue({ priority: 'critical', priorityScore: 0.95 }),
    } as any;

    const emptyRepo = (): jest.Mocked<Repository<any>> =>
      ({
        find: jest.fn().mockResolvedValue([]),
        save: jest.fn().mockResolvedValue(undefined),
      }) as any;

    // SAST returns two full pages + one partial page so the loop must go
    // through at least two keyset iterations before exhaustion.
    const sastPage1 = makePage('sast', BATCH_SIZE, 0);
    const sastPage2 = makePage('sast', BATCH_SIZE, BATCH_SIZE);
    const sastPage3 = makePage('sast', 3, BATCH_SIZE * 2);
    const sastRepo: jest.Mocked<Repository<any>> = {
      find: jest
        .fn()
        .mockResolvedValueOnce(sastPage1)
        .mockResolvedValueOnce(sastPage2)
        .mockResolvedValueOnce(sastPage3)
        .mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    const processor = new CvssRecalculationProcessor(
      calculator,
      priorityCalculator,
      sastRepo,
      emptyRepo(), // sca
      emptyRepo(), // iac
      emptyRepo(), // container
      emptyRepo(), // secret
      emptyRepo(), // cicd
    );

    return {
      processor,
      sastRepo,
      lastSastId: sastPage2[sastPage2.length - 1].id,
      firstSastId: sastPage1[sastPage1.length - 1].id,
    };
  }

  it('recomputePrioritiesForProject never uses offset/skip pagination', async () => {
    const { processor, sastRepo } = buildProcessor();

    await processor.recomputePrioritiesForProject('proj-keyset', 3, 3);

    for (const call of sastRepo.find.mock.calls) {
      const options = call[0] as any;
      expect(options).toBeDefined();
      expect(options.skip).toBeUndefined();
    }
  });

  it('recomputePrioritiesForProject orders by id ASC on every call (keyset requirement)', async () => {
    const { processor, sastRepo } = buildProcessor();

    await processor.recomputePrioritiesForProject('proj-keyset', 3, 3);

    for (const call of sastRepo.find.mock.calls) {
      const options = call[0] as any;
      expect(options.order).toEqual({ id: 'ASC' });
    }
  });

  it('recomputePrioritiesForProject uses MoreThan(lastId) on subsequent pages', async () => {
    const { processor, sastRepo, firstSastId } = buildProcessor();

    await processor.recomputePrioritiesForProject('proj-keyset', 3, 3);

    // First call: no id filter (lastId undefined).
    expect(sastRepo.find.mock.calls.length).toBeGreaterThanOrEqual(2);
    const firstCall = sastRepo.find.mock.calls[0][0] as any;
    expect(firstCall.where.projectId).toBe('proj-keyset');
    expect(firstCall.where.id).toBeUndefined();

    // Second call must carry WHERE id > <last id of page 1>.
    const secondCall = sastRepo.find.mock.calls[1][0] as any;
    const idOperator = secondCall.where.id;
    expect(idOperator).toBeInstanceOf(FindOperator);
    expect((idOperator as FindOperator<string>).type).toBe('moreThan');
    expect((idOperator as FindOperator<string>).value).toBe(firstSastId);
  });

  it('recomputePrioritiesForProject still iterates every page (terminates on empty page)', async () => {
    const { processor, sastRepo } = buildProcessor();

    // Two full pages (500 each) + one partial (3) + one terminating empty.
    // Loop MUST make at least 3 find() calls; 4th may happen because the
    // partial page (size < BATCH_SIZE) is a valid stop condition.
    await processor.recomputePrioritiesForProject('proj-keyset', 3, 3);

    expect(sastRepo.find.mock.calls.length).toBeGreaterThanOrEqual(3);
    // Every non-override detection from page 1 + page 2 + page 3 (1003 total)
    // was saved. priorityCalculator.calculate returns priority=critical which
    // differs from det.currentPriority=normal, so all 1003 are saved.
    const savedCount = sastRepo.save.mock.calls
      .map((c: any[]) => (Array.isArray(c[0]) ? c[0].length : 1))
      .reduce((a: number, b: number) => a + b, 0);
    expect(savedCount).toBe(BATCH_SIZE * 2 + 3);
  });
});

describe('CvssRecalculationProcessor – secret priority rule', () => {
  let processor: CvssRecalculationProcessor;
  let priorityCalculator: jest.Mocked<PriorityCalculatorService>;
  let secretRepo: jest.Mocked<Repository<any>>;

  const makeEmptyRepo = () =>
    ({ find: jest.fn().mockResolvedValue([]), save: jest.fn() }) as any;

  beforeEach(() => {
    // If a secret ever reached the composite calculator it would become
    // 'normal' — the assertions below prove the rule path is used instead.
    priorityCalculator = {
      calculate: jest
        .fn()
        .mockReturnValue({ priority: 'normal', priorityScore: 50 }),
      decompose: jest.fn(),
      computeContextModifier: jest.fn(),
    } as any;
    const calculator = {
      isSeverityDefaultVector: jest.fn().mockReturnValue(false),
      applyEnvironmentalMetrics: jest.fn(),
      computeCvss4Base: jest.fn(),
    } as any;

    secretRepo = { find: jest.fn(), save: jest.fn() } as any;

    processor = new CvssRecalculationProcessor(
      calculator,
      priorityCalculator,
      makeEmptyRepo(), // sast
      makeEmptyRepo(), // sca
      makeEmptyRepo(), // iac
      makeEmptyRepo(), // container
      secretRepo, // secret
      makeEmptyRepo(), // cicd
    );
  });

  it('recomputePrioritiesForProject sets every secret to critical_urgent, never the composite (file context does not demote)', async () => {
    const prodSecret = {
      id: 's1',
      path: 'src/config/db.ts',
      currentPriority: 'normal',
      priorityScore: 50,
      priorityManualOverride: false,
    };
    // A historic test-file secret demoted to `urgent` under the old rule must
    // be healed back to critical_urgent — a leaked secret in a test file is
    // still a real leaked secret.
    const testSecret = {
      id: 's2',
      path: 'src/auth/login.test.ts',
      currentPriority: 'urgent',
      priorityScore: 70,
      priorityManualOverride: false,
    };
    let page = 0;
    secretRepo.find.mockImplementation(async () => {
      page++;
      return page === 1 ? [prodSecret, testSecret] : [];
    });

    await processor.recomputePrioritiesForProject('proj-secret', 3, 3);

    expect(priorityCalculator.calculate).not.toHaveBeenCalled();
    expect(prodSecret.currentPriority).toBe('critical_urgent');
    expect(prodSecret.priorityScore).toBe(100);
    expect(testSecret.currentPriority).toBe('critical_urgent');
    expect(testSecret.priorityScore).toBe(100);
    expect(secretRepo.save).toHaveBeenCalledTimes(1);
    expect(secretRepo.save.mock.calls[0][0]).toEqual([prodSecret, testSecret]);
  });

  it('recomputePrioritiesForProject skips secrets with a manual priority override', async () => {
    const overridden = {
      id: 's3',
      path: 'src/config/db.ts',
      currentPriority: 'low',
      priorityScore: 10,
      priorityManualOverride: true,
    };
    let page = 0;
    secretRepo.find.mockImplementation(async () => {
      page++;
      return page === 1 ? [overridden] : [];
    });

    await processor.recomputePrioritiesForProject('proj-secret', 3, 3);

    expect(overridden.currentPriority).toBe('low');
    expect(secretRepo.save).not.toHaveBeenCalled();
  });

  it('backfillMissingExploitability does NOT touch secrets (exploitability is not applicable)', async () => {
    // A secret missing its verdict must stay untouched — the secret repo is no
    // longer part of the exploitability backfill sweep.
    await processor.backfillMissingExploitability('proj-secret');

    expect(secretRepo.find).not.toHaveBeenCalled();
    expect(secretRepo.save).not.toHaveBeenCalled();
  });
});

describe('CvssRecalculationProcessor – findings scored from their label', () => {
  // A finding with no CVSS of its own carries the default vector of its
  // label. A recalculation must give it the current default vector, with no
  // environmental adjustment, so the label is the severity shown. Rows
  // scored with a former default vector (the former high one scored 9.3,
  // critical) are corrected the same way.
  const context = {
    internetExposure: 'public',
    networkSegmentation: 'flat',
    environment: 'production',
    dataClassification: 'confidential',
    businessCriticality: 'medium',
    handlesPii: false,
    handlesPaymentData: false,
    safetyCritical: false,
  };
  const real = new CvssCalculatorService();

  function run(rows: any[]) {
    const isRecalcQuery = (options: any) =>
      options?.where?.cvss4Vector instanceof FindOperator &&
      options.where.cvss4Vector.type === 'not' &&
      options.where.id === undefined;
    const repoOf = (list: any[]) =>
      ({
        find: jest.fn(async (options: any) =>
          isRecalcQuery(options) ? list : [],
        ),
        save: jest.fn().mockResolvedValue(undefined),
      }) as any;
    const sastRepo = repoOf(rows);
    const empty = () => repoOf([]);
    const processor = new CvssRecalculationProcessor(
      real,
      {
        calculate: jest
          .fn()
          .mockReturnValue({ priority: 'high', priorityScore: 0.7 }),
      } as any,
      sastRepo,
      empty(),
      empty(),
      empty(),
      empty(),
      empty(),
    );
    return { processor, sastRepo };
  }

  it.each([
    ['high', 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:L/SC:N/SI:N/SA:N'],
    ['LOW', 'CVSS:4.0/AV:L/AC:L/AT:N/PR:L/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N'],
    ['medium', real.severityToDefaultVector('medium')],
  ])(
    'restores the %s label of a row scored from it (vector %s)',
    async (label, vector) => {
      const row = {
        id: 'det-1',
        currentSeverity: label,
        cvss4Vector: vector,
        cvss4BaseScore: 9.3,
        cvss4EnvironmentalScore: 9.3,
        cvss4EnvironmentalVector: `${vector}/CR:H`,
        effectiveSeverity: 'critical',
        priorityManualOverride: false,
      };
      const { processor, sastRepo } = run([row]);

      await processor.recalculateForProject('project-1', context);

      const expected = real.computeCvss4Base({ severity: label });
      expect(sastRepo.save).toHaveBeenCalled();
      expect(row).toEqual(
        expect.objectContaining({
          cvss4Vector: expected.vector,
          cvss4BaseScore: expected.baseScore,
          cvss4EnvironmentalScore: expected.baseScore,
          cvss4EnvironmentalVector: null,
          effectiveSeverity: label.toLowerCase(),
        }),
      );
    },
  );

  it('still applies the security context to a vector of the finding’s own', async () => {
    const own =
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:L/SC:N/SI:N/SA:N';
    const row = {
      id: 'det-2',
      // The former high default vector, under another label: a converted
      // CVSS 3.1 vector, not a default one.
      currentSeverity: 'critical',
      cvss4Vector: own,
      cvss4BaseScore: 9.3,
      cvss4EnvironmentalScore: null,
      cvss4EnvironmentalVector: null,
      effectiveSeverity: null,
      priorityManualOverride: false,
    };
    const { processor } = run([row]);

    await processor.recalculateForProject('project-1', context);

    const env = real.applyEnvironmentalMetrics(own, context);
    expect(row.cvss4Vector).toBe(own);
    expect(row.cvss4EnvironmentalVector).toBe(env.fullVector);
    expect(row.cvss4EnvironmentalScore).toBe(env.environmentalScore);
  });
});
