import { GitHistoryCursorService } from './git-history/git-history-cursor.service';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { of } from 'rxjs';

import { ScanService } from './scan.service';
import {
  OrganizationManager,
  ProjectAppsecMarker,
  ScanPipelineEvents,
  ScanProgressUtils,
  ScanStateStore,
  ScanUtils,
} from './core';
import { ScanStateManager } from './core/scanStateManager';
import { ContainerScanBranchResolver } from './core/containerScanBranchResolver';
import { ImportScanService } from './import/import-scan.service';
import { FileManagementService } from '../file/file-management.service';
import { Scan } from 'src/entities/scan.entity';
import { Container } from 'src/entities/container.entity';
import { Scanner } from 'src/entities/scanner.entity';
import { SupportedLanguage } from 'src/entities/supported-language.entity';
import { COMMUNITY_BINDINGS } from 'src/edition/community-bindings';
import {
  SCANNER_ORCHESTRATOR_PORT,
  SCANNERS_NOT_AVAILABLE,
} from 'src/edition/ports/scanner-orchestrator.port';
import { CreateScanRequest } from '@grpc/security-scanning/scan';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';

/**
 * The core ScanService in the Community Edition: every port is bound to its
 * Community answer, so a scan that is not an import scan is refused before
 * anything is read or written. The closed edition tests its own behaviour.
 *
 * Import scans: CreateScan of an import row (waiting_for_file,
 * typed by import_type, no conflict check, no orchestrator) and StartScan,
 * which hands the stored file to analysis-reporting through ImportScanService
 * without a pod.
 */

const repoMock = () => ({
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn(),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
  create: jest.fn((x: unknown) => x),
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn(),
});

/** The chainable query builder the state store's conditional UPDATEs use. */
const makeQb = () => {
  const qb = {
    update: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  qb.update.mockReturnValue(qb);
  qb.set.mockReturnValue(qb);
  qb.where.mockReturnValue(qb);
  qb.andWhere.mockReturnValue(qb);
  return qb;
};

class LoggerStub {
  log() {}
  error() {}
  warn() {}
  debug() {}
}

/** The RpcException's error object (code and message). */
async function rpcErrorOf(
  promise: Promise<unknown>,
): Promise<{ code?: number; message?: string }> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RpcException);
    return (error as RpcException).getError() as {
      code?: number;
      message?: string;
    };
  }
  throw new Error('expected a rejection');
}

describe('ScanService (Community Edition)', () => {
  let module: TestingModule;
  let service: ScanService;
  let scanRepository: ReturnType<typeof repoMock>;
  let containerRepository: ReturnType<typeof repoMock>;
  let projectClient: {
    get: jest.Mock;
    update: jest.Mock;
    markProjectAppsec: jest.Mock;
  };
  let importResults: jest.Mock;
  let coverageFor: jest.Mock;
  let resolveScanBranch: jest.Mock;
  let realtimePublish: jest.Mock;

  const ORIGINAL_EDITION = process.env.CYBEDEFEND_EDITION;
  const setEdition = (value: string | undefined): void => {
    if (value === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = value;
  };

  beforeEach(async () => {
    projectClient = {
      get: jest.fn().mockReturnValue(
        of({
          id: 'p1',
          organizationId: 'org-1',
          enabledScanTypes: ['sast'],
        }),
      ),
      update: jest.fn().mockReturnValue(of({ success: true })),
      markProjectAppsec: jest.fn().mockReturnValue(of({ appsec: true })),
    };
    importResults = jest.fn().mockReturnValue(of({ accepted: true }));
    coverageFor = jest.fn().mockResolvedValue(null);
    resolveScanBranch = jest.fn().mockReturnValue(of({ branch: 'main' }));
    realtimePublish = jest.fn().mockResolvedValue(undefined);
    const qb = makeQb();
    const scanRepo = repoMock();
    scanRepo.createQueryBuilder.mockReturnValue(qb);
    const gmClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue(projectClient),
    };
    const arClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({ importResults }),
    };
    const fmClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({
        deleteImportObject: jest.fn().mockReturnValue(of({ success: true })),
        deleteFile: jest.fn().mockReturnValue(of({ success: true })),
      }),
    };
    const eiClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({ resolveScanBranch }),
    };

    module = await Test.createTestingModule({
      providers: [
        ScanService,
        ImportScanService,
        ScanStateStore,
        ScanStateManager,
        ScanPipelineEvents,
        ProjectAppsecMarker,
        OrganizationManager,
        FileManagementService,
        ContainerScanBranchResolver,
        // updateScanData bounds the stored message through it.
        ScanUtils,
        // getScan reads the progress through this primitive.
        {
          provide: ScanProgressUtils,
          useValue: { calculateScanProgress: jest.fn().mockResolvedValue(0) },
        },
        ...COMMUNITY_BINDINGS,
        { provide: GitHistoryCursorService, useValue: { coverageFor } },
        {
          provide: RealtimeEventPublisher,
          useValue: { publish: realtimePublish },
        },
        { provide: getRepositoryToken(Scan), useValue: scanRepo },
        { provide: getRepositoryToken(Container), useValue: repoMock() },
        { provide: getRepositoryToken(Scanner), useValue: repoMock() },
        {
          provide: getRepositoryToken(SupportedLanguage),
          useValue: repoMock(),
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_k: string, d?: unknown) => d ?? '') },
        },
        { provide: Logger, useClass: LoggerStub },
        { provide: 'GLOBAL_MANAGEMENT_SERVICE', useValue: gmClient },
        { provide: 'ANALYSIS_REPORTING_SERVICE', useValue: arClient },
        { provide: 'FILE_MANAGEMENT_SERVICE', useValue: fmClient },
        { provide: 'EXTERNAL_INTEGRATIONS_SERVICE', useValue: eiClient },
        {
          provide: 'POLICY_MANAGEMENT_SERVICE',
          useValue: { getService: jest.fn(() => ({})) },
        },
      ],
    })
      // Every other dependency, the gRPC clients included, is an inert
      // stand-in.
      .useMocker(() => ({ getService: jest.fn(() => ({})) }))
      .compile();

    service = module.get(ScanService);
    service.onModuleInit();
    module.get(OrganizationManager).onModuleInit();
    module.get(ImportScanService).onModuleInit();
    module.get(ScanStateManager).onModuleInit();
    module.get(FileManagementService).onModuleInit();
    module.get(ContainerScanBranchResolver).onModuleInit();
    scanRepository = module.get(getRepositoryToken(Scan));
    containerRepository = module.get(getRepositoryToken(Container));
  });

  afterEach(async () => {
    setEdition(ORIGINAL_EDITION);
    await module.close();
  });

  it('refuses a code scan at CreateScan with SCANNERS_NOT_AVAILABLE and saves nothing', async () => {
    const error = await rpcErrorOf(
      service.createScan({
        scanId: 's1',
        projectId: 'p1',
        initializerUserId: 'u1',
        privateScan: false,
        vulnerabilityTypes: [],
      }),
    );

    expect(error).toMatchObject({
      code: status.FAILED_PRECONDITION,
      message: SCANNERS_NOT_AVAILABLE,
    });
    expect(scanRepository.save).not.toHaveBeenCalled();
    expect(projectClient.get).not.toHaveBeenCalled();
  });

  it.each([
    { scanType: 'container' },
    { isDiffScan: true },
    { graphOnly: true },
  ])('refuses %o the same way', async (variant) => {
    const error = await rpcErrorOf(
      service.createScan({
        scanId: 's2',
        projectId: 'p1',
        initializerUserId: 'u1',
        privateScan: false,
        vulnerabilityTypes: [],
        ...variant,
      }),
    );

    expect(error).toMatchObject({
      code: status.FAILED_PRECONDITION,
      message: SCANNERS_NOT_AVAILABLE,
    });
    expect(scanRepository.save).not.toHaveBeenCalled();
    expect(scanRepository.find).not.toHaveBeenCalled();
    expect(projectClient.get).not.toHaveBeenCalled();
  });

  // A project whose every scanner is off is refused at the check every
  // start route runs before it signs an upload URL, not after the upload.
  it('checkExistingScan refuses a project the orchestrator says has no scanner, before reading any scan', async () => {
    const orchestrator = module.get(SCANNER_ORCHESTRATOR_PORT);
    const refusal = new RpcException({
      code: status.FAILED_PRECONDITION,
      message: 'NO_SCANNER_ENABLED',
    });
    const assertSpy = jest
      .spyOn(orchestrator, 'assertProjectScannable')
      .mockRejectedValue(refusal);

    const error = await rpcErrorOf(service.checkExistingScan('p1', 'main'));

    expect(error).toMatchObject({
      code: status.FAILED_PRECONDITION,
      message: 'NO_SCANNER_ENABLED',
    });
    expect(assertSpy).toHaveBeenCalledWith('p1', undefined);
    expect(scanRepository.findOne).not.toHaveBeenCalled();
  });

  // file-management fails a scan whose archive never arrived with code 98,
  // its category, its message and an end time: all four are stored.
  it('updateScanData stores the code, category, message and end time of an archive never received (98)', async () => {
    scanRepository.findOne.mockResolvedValue({
      id: 's98',
      state: 'waiting_for_file',
    });
    containerRepository.find.mockResolvedValue([]);
    const endTime = '2026-11-14T10:30:00.000Z';

    await service.updateScanData({
      scanId: 's98',
      state: 'failed',
      errorMessage:
        "ARCHIVE_NOT_RECEIVED: No archive was uploaded within 30 minutes of the scan's start",
      errorCode: 98,
      errorCategory: 'archive',
      endTime,
    });

    const saved = scanRepository.save.mock.calls[0][0];
    expect(saved).toMatchObject({
      state: 'failed',
      errorCode: 98,
      errorCategory: 'archive',
      errorMessage: expect.stringMatching(/^ARCHIVE_NOT_RECEIVED: /),
    });
    expect(saved.endTime).toEqual(new Date(endTime));
  });

  it('refuses StartScan of a scan row that is not an import scan', async () => {
    scanRepository.findOne.mockResolvedValue({
      id: 's3',
      state: 'waiting_for_file',
    });

    const error = await rpcErrorOf(
      service.startScan({ scanId: 's3', projectId: 'p1', language: [] }),
    );

    expect(error).toMatchObject({
      code: status.FAILED_PRECONDITION,
      message: SCANNERS_NOT_AVAILABLE,
    });
    expect(scanRepository.save).not.toHaveBeenCalled();
    expect(scanRepository.update).not.toHaveBeenCalled();
    expect(containerRepository.save).not.toHaveBeenCalled();
  });

  describe('createScan — import scans', () => {
    const importRequest = (
      overrides: Partial<CreateScanRequest> = {},
    ): CreateScanRequest => ({
      scanId: 's-import',
      projectId: 'p1',
      initializerUserId: 'u1',
      privateScan: false,
      vulnerabilityTypes: [],
      ...overrides,
    });

    beforeEach(() => setEdition('community'));

    it('creates an import scan waiting for its file, typed by the import, without a code-scan conflict check', async () => {
      const orchestrator = module.get(SCANNER_ORCHESTRATOR_PORT);
      const assertSpy = jest.spyOn(orchestrator, 'assertScanSupported');
      const saveNewScanSpy = jest.spyOn(orchestrator, 'saveNewScan');

      const result = await service.createScan(
        importRequest({
          importFormat: 'sarif',
          importType: 'sast',
          branch: 'refs/heads/main',
          vulnerabilityTypes: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
        }),
      );

      expect(result).toMatchObject({ success: true });
      expect(scanRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'waiting_for_file',
          scanType: 'sast',
          branch: 'main',
          importFormat: 'sarif',
          importTool: null,
        }),
      );
      // an import blocks nothing and is blocked by nothing: the conflict
      // check's read never runs, and the orchestrator is never asked
      expect(scanRepository.findOne).not.toHaveBeenCalled();
      expect(assertSpy).not.toHaveBeenCalled();
      expect(saveNewScanSpy).not.toHaveBeenCalled();
    });

    it('normalises the import tool list onto the scan', async () => {
      await service.createScan(
        importRequest({
          importFormat: 'sarif',
          importType: 'sast',
          importTool: 'Semgrep OSS',
          branch: 'main',
        }),
      );

      expect(scanRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ importTool: 'semgreposs' }),
      );
    });

    it.each([
      {
        case: 'an unsupported format',
        request: { importFormat: 'json', importType: 'sast', branch: 'main' },
        message: 'IMPORT_FORMAT_UNSUPPORTED',
      },
      {
        case: 'a missing import type',
        request: { importFormat: 'sarif', branch: 'main' },
        message: 'IMPORT_TYPE_INVALID',
      },
      {
        case: 'an unknown import type',
        request: { importFormat: 'sarif', importType: 'dast', branch: 'main' },
        message: 'IMPORT_TYPE_INVALID',
      },
      {
        case: 'vulnerability_types read as the type',
        request: {
          importFormat: 'sarif',
          vulnerabilityTypes: ['sast'],
          branch: 'main',
        },
        message: 'IMPORT_TYPE_INVALID',
      },
      {
        case: 'a missing branch',
        request: { importFormat: 'sarif', importType: 'sast' },
        message: 'IMPORT_BRANCH_REQUIRED',
      },
      {
        case: 'a blank branch',
        request: { importFormat: 'sarif', importType: 'sast', branch: '   ' },
        message: 'IMPORT_BRANCH_REQUIRED',
      },
      {
        case: 'a too long branch',
        request: {
          importFormat: 'sarif',
          importType: 'sast',
          branch: 'x'.repeat(256),
        },
        message: 'IMPORT_BRANCH_TOO_LONG',
      },
      {
        case: 'scanType on an import',
        request: {
          importFormat: 'sarif',
          importType: 'container',
          importImage: 'img:1',
          scanType: 'container',
          branch: 'main',
        },
        message: 'IMPORT_FLAGS_CONFLICT',
      },
      {
        case: 'an image with a non-container type',
        request: {
          importFormat: 'sarif',
          importType: 'sast',
          importImage: 'img:1',
          branch: 'main',
        },
        message: 'IMPORT_FLAGS_CONFLICT',
      },
      {
        case: 'an SBOM with a non-sca type',
        request: {
          importFormat: 'sarif',
          importType: 'container',
          importImage: 'img:1',
          importSbom: true,
          branch: 'main',
        },
        message: 'IMPORT_FLAGS_CONFLICT',
      },
      {
        case: 'an SBOM with a code type',
        request: {
          importFormat: 'sarif',
          importType: 'sast',
          importSbom: true,
          branch: 'main',
        },
        message: 'IMPORT_FLAGS_CONFLICT',
      },
      {
        case: 'isDiffScan on an import',
        request: {
          importFormat: 'sarif',
          importType: 'sast',
          isDiffScan: true,
          branch: 'main',
        },
        message: 'IMPORT_FLAGS_CONFLICT',
      },
      {
        case: 'a container import without an image',
        request: {
          importFormat: 'sarif',
          importType: 'container',
          branch: 'main',
        },
        message: 'IMPORT_IMAGE_REQUIRED',
      },
      {
        case: 'a container import with a blank image',
        request: {
          importFormat: 'sarif',
          importType: 'container',
          importImage: '  ',
          branch: 'main',
        },
        message: 'IMPORT_IMAGE_REQUIRED',
      },
    ])(
      'refuses $case with INVALID_ARGUMENT $message',
      async ({ request, message }) => {
        const resolveSpy = jest.spyOn(
          module.get(ContainerScanBranchResolver),
          'resolve',
        );

        const error = await rpcErrorOf(
          service.createScan(importRequest(request)),
        );

        expect(error).toMatchObject({
          code: status.INVALID_ARGUMENT,
          message,
        });
        expect(scanRepository.save).not.toHaveBeenCalled();
        expect(resolveSpy).not.toHaveBeenCalled();
      },
    );

    describe('edition gate of sca and container imports', () => {
      // The refusals of sca and container imports outside the Community
      // Edition are tested by the closed edition.
      it('accepts an sca import in the Community Edition, with the code-scan branch rule', async () => {
        setEdition('community');
        const resolveSpy = jest.spyOn(
          module.get(ContainerScanBranchResolver),
          'resolve',
        );

        await service.createScan(
          importRequest({
            importFormat: 'sarif',
            importType: 'sca',
            branch: 'refs/heads/develop',
          }),
        );

        expect(scanRepository.save).toHaveBeenCalledWith(
          expect.objectContaining({
            scanType: 'sca',
            branch: 'develop',
            importFormat: 'sarif',
          }),
        );
        const saved = scanRepository.save.mock.calls[0][0] as Scan;
        expect(saved.metadata?.imageToScan).toBeUndefined();
        expect(saved.metadata?.importSbom).toBeUndefined();
        expect(resolveSpy).not.toHaveBeenCalled();
      });

      it('keeps the SBOM of an sca import in metadata.importSbom', async () => {
        setEdition('community');
        await service.createScan(
          importRequest({
            importFormat: 'sarif',
            importType: 'sca',
            importSbom: true,
            branch: 'main',
          }),
        );
        expect(scanRepository.save).toHaveBeenCalledWith(
          expect.objectContaining({
            scanType: 'sca',
            metadata: { importSbom: true },
          }),
        );
      });
    });

    it('creates a container import with its image, typed container, and no image reservation', async () => {
      setEdition('community');

      await service.createScan(
        importRequest({
          importFormat: 'sarif',
          importType: 'container',
          importImage: ' ghcr.io/acme/api:1.2 ',
          branch: 'main',
        }),
      );

      expect(scanRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'waiting_for_file',
          scanType: 'container',
          importFormat: 'sarif',
          metadata: { imageToScan: 'ghcr.io/acme/api:1.2' },
        }),
      );
      // no image pool, no code pool: an import reserves nothing
      expect(scanRepository.find).not.toHaveBeenCalled();
      expect(scanRepository.findOne).not.toHaveBeenCalled();
    });

    it('resolves the branch of a container import through ResolveScanBranch', async () => {
      setEdition('community');
      projectClient.get.mockReturnValueOnce(
        of({
          id: 'p1',
          organizationId: 'org-1',
          enabledScanTypes: ['sast'],
          referenceBranch: 'develop',
        }),
      );
      const resolveSpy = jest
        .spyOn(module.get(ContainerScanBranchResolver), 'resolve')
        .mockResolvedValueOnce('Main');

      await service.createScan(
        importRequest({
          importFormat: 'sarif',
          importType: 'container',
          importImage: 'img:1',
          branch: 'main',
        }),
      );

      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(resolveSpy).toHaveBeenCalledWith('p1', 'main', 'develop');
      expect(scanRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ branch: 'Main', scanType: 'container' }),
      );

      scanRepository.save.mockClear();
      resolveSpy.mockRejectedValueOnce(
        new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'Branch not found',
        }),
      );
      const error = await rpcErrorOf(
        service.createScan(
          importRequest({
            importFormat: 'sarif',
            importType: 'container',
            importImage: 'img:1',
            branch: 'main',
          }),
        ),
      );
      expect(error).toMatchObject({
        code: status.INVALID_ARGUMENT,
        message: 'Branch not found',
      });
      expect(scanRepository.save).not.toHaveBeenCalled();
    });
  });

  it('hands a container import to analysis-reporting with its image, and launches nothing', async () => {
    // SARIF import is a Community Edition feature.
    setEdition('community');
    scanRepository.findOne.mockResolvedValue({
      id: 's-c',
      projectId: 'p1',
      organizationId: 'org-1',
      state: 'waiting_for_file',
      scanType: 'container',
      branch: 'main',
      importFormat: 'sarif',
      importTool: null,
      metadata: { imageToScan: 'ghcr.io/acme/api:1.2' },
    } as unknown as Scan);
    const startSpy = jest.spyOn(
      module.get(SCANNER_ORCHESTRATOR_PORT),
      'startScan',
    );

    const result = await service.startScan({
      scanId: 's-c',
      projectId: 'p1',
      language: [],
    });

    expect(importResults).toHaveBeenCalledWith(
      expect.objectContaining({
        vulnerabilityType: 'container',
        image: 'ghcr.io/acme/api:1.2',
        fileKey: 'import/p1/s-c.sarif',
      }),
    );
    // StartScan of an import returns before the orchestrator: no pod, so no
    // image reservation either
    expect(startSpy).not.toHaveBeenCalled();
    expect(containerRepository.save).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, scanId: 's-c' });
  });

  describe('getScan — the git history', () => {
    it('getScan returns the pass and the branch coverage', async () => {
      const pass = {
        mode: 'incremental',
        bytes: '10',
        excludeShas: [],
        firstPass: false,
        repositoryKey: 'github:o/r',
      };
      const coverage = { complete: true, gaps: [] };
      coverageFor.mockResolvedValue(coverage);
      scanRepository.find.mockResolvedValue([
        {
          id: 's1',
          projectId: 'p1',
          branch: 'main',
          state: 'completed',
          containers: [],
          metadata: { historyPass: pass },
        } as unknown as Scan,
      ]);

      const response = await service.getScan({
        scanId: 's1',
        projectId: 'p1',
        includePipeline: true,
      });

      expect(coverageFor).toHaveBeenCalledWith('p1', 'main');
      expect(response.historyPass).toEqual(pass);
      expect(response.historyCoverage).toEqual(coverage);
    });

    const heldScan = () => [
      {
        id: 's1',
        projectId: 'p1',
        branch: 'main',
        state: 'completed',
        containers: [],
        metadata: { historyPass: { mode: 'full' } },
      } as unknown as Scan,
    ];

    it('GetScan still resolves when the coverage read fails', async () => {
      coverageFor.mockRejectedValue(new Error('table missing'));
      scanRepository.find.mockResolvedValue(heldScan());
      const response = await service.getScan({
        scanId: 's1',
        projectId: 'p1',
        includePipeline: true,
      });
      expect(response.historyPass).toEqual({ mode: 'full' });
      expect(response.historyCoverage).toBeUndefined();
    });

    it('internal GetScan calls (no includePipeline) never read the cursor', async () => {
      scanRepository.find.mockResolvedValue(heldScan());
      const response = await service.getScan({ scanId: 's1', projectId: 'p1' });
      expect(coverageFor).not.toHaveBeenCalled();
      expect(response.historyPass).toEqual({ mode: 'full' });
    });

    it('leaves both absent when the scan has no history pass and no cursor', async () => {
      scanRepository.find.mockResolvedValue([
        {
          id: 's1',
          projectId: 'p1',
          branch: 'main',
          state: 'completed',
          containers: [],
          metadata: {},
        } as unknown as Scan,
      ]);
      const response = await service.getScan({ scanId: 's1', projectId: 'p1' });
      expect(response.historyPass).toBeUndefined();
      expect(response.historyCoverage).toBeUndefined();
    });
  });

  describe('getScan — the import read model', () => {
    const scanRow = (overrides: Record<string, unknown>): Scan =>
      ({
        id: 's-imp',
        name: 'import',
        state: 'running',
        language: [],
        projectId: 'p1',
        organizationId: 'org-1',
        private: false,
        initializerUserId: 'u1',
        createAt: new Date('2026-05-01T10:00:00.000Z'),
        updatedAt: new Date('2026-05-01T11:00:00.000Z'),
        scanType: 'sast',
        startTime: new Date('2026-05-01T10:05:00.000Z'),
        endTime: null,
        containers: [],
        branch: 'main',
        metadata: {},
        isDiffScan: false,
        isGraphOnly: false,
        ...overrides,
      }) as unknown as Scan;

    it('reads an import scan with its format, tool, findings count and step', async () => {
      scanRepository.find.mockResolvedValue([
        scanRow({
          importFormat: 'sarif',
          importTool: 'semgrep',
          metadata: { importFindingsCount: 12 },
        }),
      ]);

      const response = await service.getScan({
        scanId: 's-imp',
        projectId: 'p1',
      });

      expect(response).toMatchObject({
        id: 's-imp',
        state: 'running',
        // a running import has no container: its step is the import one
        step: 'import: processing results',
        vulnerabilityDetected: 12,
        importFormat: 'sarif',
        importTool: 'semgrep',
        containers: [],
      });
    });

    const closedContainer = (id: string) => ({
      id,
      status: 'completed',
      step: 'scan',
      image: 'appsec-sast-scanner:latest',
      podName: `pod-${id}`,
      scanId: 's-held',
      processedVulnerabilities: 3,
      scanner: { scannerType: 'sast' },
    });

    it('reads a scan held for its results as processing at 99', async () => {
      scanRepository.find.mockResolvedValue([
        scanRow({
          id: 's-held',
          importFormat: null,
          resultsFinalizedAt: null,
          containers: [closedContainer('c1')],
        }),
      ]);

      const response = await service.getScan({
        scanId: 's-held',
        projectId: 'p1',
      });

      expect(response).toMatchObject({
        state: 'running',
        step: 'processing results',
        progress: 99,
        resultsStatus: 'processing',
      });
      expect(response.resultsFinalizedAt).toBeUndefined();
    });

    it('serializes resultsFinalizedAt as ISO-8601 and reads ready', async () => {
      scanRepository.find.mockResolvedValue([
        scanRow({
          id: 's-held',
          state: 'completed',
          importFormat: null,
          resultsFinalizedAt: new Date('2026-05-01T12:00:00.000Z'),
          containers: [closedContainer('c1')],
        }),
      ]);

      const response = await service.getScan({
        scanId: 's-held',
        projectId: 'p1',
      });

      expect(response.resultsStatus).toBe('ready');
      expect(response.resultsFinalizedAt).toBe('2026-05-01T12:00:00.000Z');
      expect(response.step).toBe('completed');
    });

    it('reads a code scan as before, with no import field', async () => {
      scanRepository.find.mockResolvedValue([
        scanRow({
          id: 's-code',
          state: 'completed',
          importFormat: null,
          importTool: null,
          containers: [
            {
              id: 'c1',
              status: 'completed',
              step: 'scan',
              image: 'appsec-sast-scanner:latest',
              podName: 'pod-1',
              scanId: 's-code',
              processedVulnerabilities: 7,
              scanner: { scannerType: 'sast' },
            },
          ],
        }),
      ]);

      const response = await service.getScan({
        scanId: 's-code',
        projectId: 'p1',
      });

      // Today's logic: every container completed, the count of the scanners.
      expect(response.step).toBe('completed');
      expect(response.vulnerabilityDetected).toBe(7);
      expect(response.containers).toHaveLength(1);
      expect(response.importFormat).toBeUndefined();
      expect(response.importTool).toBeUndefined();
    });

    // The agent's project id has been empty for every scan since the agent
    // keys its graph by project and branch: the answer no longer names it.
    it('answers no agent project id', async () => {
      scanRepository.find.mockResolvedValue([scanRow({ state: 'completed' })]);

      const response = await service.getScan({
        scanId: 's-imp',
        projectId: 'p1',
      });

      expect(response).not.toHaveProperty('potpieProjectId');
    });
  });
});
