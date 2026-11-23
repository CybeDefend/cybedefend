import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { ImportResultsRequest } from '@grpc/analysis-reporting/result';
import { ResultsImportController } from './results-import.controller';
import { ScanQueueService } from '../scan-queue/scan-queue.service';

const SCAN = '0193b6a8-1c2d-7e3f-8a9b-0c1d2e3f4a5b';
const PROJECT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
/** Another container's id, of the same shape. */
const randomUUIDLike = (): string => '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const request = (
  overrides: Partial<ImportResultsRequest> = {},
): ImportResultsRequest => ({
  scanId: SCAN,
  projectId: PROJECT,
  organizationId: 'org-1',
  branch: 'main',
  vulnerabilityType: 'sast',
  format: 'sarif',
  fileKey: `import/${PROJECT}/${SCAN}.sarif`,
  ...overrides,
});

const codeOf = async (
  p: Promise<unknown>,
): Promise<{ code: number; message: string } | null> => {
  try {
    await p;
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(RpcException);
    return (err as RpcException).getError() as {
      code: number;
      message: string;
    };
  }
};

describe('ResultsImportController', () => {
  let addResultsImportJob: jest.Mock;
  let controller: ResultsImportController;

  // SARIF import is a Community Edition feature: every
  // case here runs there. The refusal elsewhere is in a closed spec.
  const ORIGINAL_EDITION = process.env.CYBEDEFEND_EDITION;
  afterEach(() => {
    if (ORIGINAL_EDITION === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = ORIGINAL_EDITION;
  });

  beforeEach(() => {
    process.env.CYBEDEFEND_EDITION = 'community';
    addResultsImportJob = jest.fn().mockResolvedValue(`results-import-${SCAN}`);
    controller = new ResultsImportController({
      addResultsImportJob,
    } as unknown as ScanQueueService);
  });

  it('queues the import and answers accepted', async () => {
    await expect(controller.importResults(request())).resolves.toEqual({
      accepted: true,
    });
    expect(addResultsImportJob).toHaveBeenCalledTimes(1);
    expect(addResultsImportJob).toHaveBeenCalledWith({
      scanId: SCAN,
      projectId: PROJECT,
      organizationId: 'org-1',
      branch: 'main',
      category: 'sast',
      format: 'sarif',
      fileKey: `import/${PROJECT}/${SCAN}.sarif`,
    });
  });

  it('accepts each of the four code import types', async () => {
    for (const type of ['sast', 'iac', 'secret', 'cicd']) {
      await expect(
        controller.importResults(request({ vulnerabilityType: type })),
      ).resolves.toEqual({ accepted: true });
    }
    expect(addResultsImportJob).toHaveBeenCalledTimes(4);
  });

  it('refuses an unknown type or format with INVALID_ARGUMENT', async () => {
    for (const bad of [
      request({ vulnerabilityType: 'dast' }),
      request({ vulnerabilityType: '' }),
      request({ format: 'cyclonedx' }),
      request({ format: '' }),
    ]) {
      expect(await codeOf(controller.importResults(bad))).toEqual({
        code: status.INVALID_ARGUMENT,
        message: 'IMPORT_INVALID_REQUEST',
      });
    }
    expect(addResultsImportJob).not.toHaveBeenCalled();
  });

  it('refuses a missing field, or an image on a code import, with INVALID_ARGUMENT', async () => {
    for (const bad of [
      request({ scanId: '' }),
      request({ projectId: '' }),
      request({ branch: '' }),
      request({ fileKey: '' }),
      request({ image: 'nginx:1.27' }),
    ]) {
      expect(await codeOf(controller.importResults(bad))).toEqual({
        code: status.INVALID_ARGUMENT,
        message: 'IMPORT_INVALID_REQUEST',
      });
    }
    expect(addResultsImportJob).not.toHaveBeenCalled();
  });

  it('refuses a file key of another scan or project with INVALID_ARGUMENT', async () => {
    for (const fileKey of [
      `import/${PROJECT}/other-scan.sarif`,
      `import/other-project/${SCAN}.sarif`,
      `import/${PROJECT}/${SCAN}.sarif.gz`,
      `scan/${PROJECT}/${SCAN}.sarif`,
      `import/${PROJECT}/../${SCAN}.sarif`,
    ]) {
      expect(
        await codeOf(controller.importResults(request({ fileKey }))),
      ).toEqual({
        code: status.INVALID_ARGUMENT,
        message: 'IMPORT_INVALID_REQUEST',
      });
    }
    expect(addResultsImportJob).not.toHaveBeenCalled();
  });

  describe('sca and container', () => {
    const IMAGE = 'ghcr.io/example/api:2.0.1';
    const previous = process.env.CYBEDEFEND_EDITION;
    afterEach(() => {
      if (previous === undefined) delete process.env.CYBEDEFEND_EDITION;
      else process.env.CYBEDEFEND_EDITION = previous;
    });

    // The refusal outside the Community Edition is in a closed spec.

    it('accepts sca and container in the Community Edition, the image in the job data', async () => {
      process.env.CYBEDEFEND_EDITION = 'community';
      await expect(
        controller.importResults(request({ vulnerabilityType: 'sca' })),
      ).resolves.toEqual({ accepted: true });
      await expect(
        controller.importResults(
          request({ vulnerabilityType: 'container', image: IMAGE }),
        ),
      ).resolves.toEqual({ accepted: true });

      expect(addResultsImportJob.mock.calls[0][0]).toEqual({
        scanId: SCAN,
        projectId: PROJECT,
        organizationId: 'org-1',
        branch: 'main',
        category: 'sca',
        format: 'sarif',
        fileKey: `import/${PROJECT}/${SCAN}.sarif`,
      });
      expect(addResultsImportJob.mock.calls[1][0]).toEqual({
        scanId: SCAN,
        projectId: PROJECT,
        organizationId: 'org-1',
        branch: 'main',
        category: 'container',
        format: 'sarif',
        fileKey: `import/${PROJECT}/${SCAN}.sarif`,
        image: IMAGE,
      });
    });

    it('refuses a container import without image, and an image on another type, with IMPORT_INVALID_REQUEST', async () => {
      process.env.CYBEDEFEND_EDITION = 'community';
      for (const bad of [
        request({ vulnerabilityType: 'container' }),
        request({ vulnerabilityType: 'container', image: '' }),
        request({ vulnerabilityType: 'container', image: 'a'.repeat(256) }),
        request({ vulnerabilityType: 'sca', image: IMAGE }),
        request({ vulnerabilityType: 'iac', image: IMAGE }),
      ]) {
        expect(await codeOf(controller.importResults(bad))).toEqual({
          code: status.INVALID_ARGUMENT,
          message: 'IMPORT_INVALID_REQUEST',
        });
      }
      expect(addResultsImportJob).not.toHaveBeenCalled();
      // 255 characters is still an image
      await expect(
        controller.importResults(
          request({ vulnerabilityType: 'container', image: 'a'.repeat(255) }),
        ),
      ).resolves.toEqual({ accepted: true });
    });

    describe('with a CycloneDX SBOM', () => {
      const SBOM_KEY = `import/${PROJECT}/${SCAN}.sbom`;

      it('queues the SBOM key with an sca import', async () => {
        process.env.CYBEDEFEND_EDITION = 'community';
        await expect(
          controller.importResults(
            request({ vulnerabilityType: 'sca', sbomFileKey: SBOM_KEY }),
          ),
        ).resolves.toEqual({ accepted: true });
        expect(addResultsImportJob.mock.calls[0][0]).toEqual({
          scanId: SCAN,
          projectId: PROJECT,
          organizationId: 'org-1',
          branch: 'main',
          category: 'sca',
          format: 'sarif',
          fileKey: `import/${PROJECT}/${SCAN}.sarif`,
          sbomFileKey: SBOM_KEY,
        });
      });

      it('reads an empty SBOM key as none', async () => {
        process.env.CYBEDEFEND_EDITION = 'community';
        await controller.importResults(
          request({ vulnerabilityType: 'sca', sbomFileKey: '' }),
        );
        expect(addResultsImportJob.mock.calls[0][0]).not.toHaveProperty(
          'sbomFileKey',
        );
      });

      it('refuses an SBOM with another type, a container, or a key of another scan', async () => {
        process.env.CYBEDEFEND_EDITION = 'community';
        const CONTAINER = '3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f';
        for (const bad of [
          request({
            vulnerabilityType: 'container',
            image: IMAGE,
            sbomFileKey: SBOM_KEY,
          }),
          request({ vulnerabilityType: 'iac', sbomFileKey: SBOM_KEY }),
          // A container's SBOM is its own, never the scan-wide one.
          request({
            vulnerabilityType: 'sca',
            containerId: CONTAINER,
            fileKey: `import/${PROJECT}/${SCAN}/${CONTAINER}.sarif`,
            sbomFileKey: SBOM_KEY,
          }),
          // And the scan-wide import never takes a container's.
          request({
            vulnerabilityType: 'sca',
            sbomFileKey: `import/${PROJECT}/${SCAN}/${CONTAINER}.sbom`,
          }),
          request({
            vulnerabilityType: 'sca',
            sbomFileKey: `import/${PROJECT}/${randomUUIDLike()}.sbom`,
          }),
          request({
            vulnerabilityType: 'sca',
            sbomFileKey: `import/${PROJECT}/${SCAN}.sarif`,
          }),
        ]) {
          expect(await codeOf(controller.importResults(bad))).toEqual({
            code: status.INVALID_ARGUMENT,
            message: 'IMPORT_INVALID_REQUEST',
          });
        }
        expect(addResultsImportJob).not.toHaveBeenCalled();
      });
    });
  });

  describe('per scanner container (Community cluster scans)', () => {
    const CONTAINER = '3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f';
    const CONTAINER_KEY = `import/${PROJECT}/${SCAN}/${CONTAINER}.sarif`;
    const previous = process.env.CYBEDEFEND_EDITION;
    afterEach(() => {
      if (previous === undefined) delete process.env.CYBEDEFEND_EDITION;
      else process.env.CYBEDEFEND_EDITION = previous;
    });

    it('with container_id, takes the key import/<p>/<s>/<c>.sarif and queues the container in the job', async () => {
      await expect(
        controller.importResults(
          request({ containerId: CONTAINER, fileKey: CONTAINER_KEY }),
        ),
      ).resolves.toEqual({ accepted: true });
      expect(addResultsImportJob).toHaveBeenCalledWith({
        scanId: SCAN,
        projectId: PROJECT,
        organizationId: 'org-1',
        branch: 'main',
        category: 'sast',
        format: 'sarif',
        fileKey: CONTAINER_KEY,
        containerId: CONTAINER,
      });
    });

    it('with container_id, refuses the scan-wide key and a key naming another container', async () => {
      for (const fileKey of [
        `import/${PROJECT}/${SCAN}.sarif`,
        `import/${PROJECT}/${SCAN}/${randomUUIDLike()}.sarif`,
        `import/${PROJECT}/other-scan/${CONTAINER}.sarif`,
        `import/${PROJECT}/${SCAN}/${CONTAINER}.sarif.gz`,
      ]) {
        expect(
          await codeOf(
            controller.importResults(
              request({ containerId: CONTAINER, fileKey }),
            ),
          ),
        ).toEqual({
          code: status.INVALID_ARGUMENT,
          message: 'IMPORT_INVALID_REQUEST',
        });
      }
      expect(addResultsImportJob).not.toHaveBeenCalled();
    });

    it('without container_id, keeps import/<p>/<s>.sarif and refuses a per-container key', async () => {
      await expect(controller.importResults(request())).resolves.toEqual({
        accepted: true,
      });
      expect(addResultsImportJob.mock.calls[0][0]).not.toHaveProperty(
        'containerId',
      );
      expect(addResultsImportJob.mock.calls[0][0]).not.toHaveProperty(
        'severities',
      );
      expect(
        await codeOf(
          controller.importResults(request({ fileKey: CONTAINER_KEY })),
        ),
      ).toEqual({
        code: status.INVALID_ARGUMENT,
        message: 'IMPORT_INVALID_REQUEST',
      });
      expect(addResultsImportJob).toHaveBeenCalledTimes(1);
    });

    it('refuses a container_id that is not a UUID with IMPORT_INVALID_REQUEST', async () => {
      for (const containerId of [
        'c-1',
        '../x',
        `${CONTAINER}/..`,
        `${CONTAINER}0`,
        CONTAINER.replace(/-/g, ''),
      ]) {
        expect(
          await codeOf(
            controller.importResults(
              request({
                containerId,
                fileKey: `import/${PROJECT}/${SCAN}/${containerId}.sarif`,
              }),
            ),
          ),
        ).toEqual({
          code: status.INVALID_ARGUMENT,
          message: 'IMPORT_INVALID_REQUEST',
        });
      }
      expect(addResultsImportJob).not.toHaveBeenCalled();
    });

    it('accepts a per-container request with a branch, and still refuses one without', async () => {
      await expect(
        controller.importResults(
          request({
            containerId: CONTAINER,
            fileKey: CONTAINER_KEY,
            branch: 'main',
          }),
        ),
      ).resolves.toEqual({ accepted: true });
      expect(addResultsImportJob.mock.calls[0][0].branch).toBe('main');
      expect(
        await codeOf(
          controller.importResults(
            request({
              containerId: CONTAINER,
              fileKey: CONTAINER_KEY,
              branch: '',
            }),
          ),
        ),
      ).toEqual({
        code: status.INVALID_ARGUMENT,
        message: 'IMPORT_INVALID_REQUEST',
      });
      expect(addResultsImportJob).toHaveBeenCalledTimes(1);
    });

    it('an sca container takes its own SBOM key import/<p>/<s>/<c>.sbom into the job', async () => {
      process.env.CYBEDEFEND_EDITION = 'community';
      const sbomFileKey = `import/${PROJECT}/${SCAN}/${CONTAINER}.sbom`;
      await expect(
        controller.importResults(
          request({
            vulnerabilityType: 'sca',
            containerId: CONTAINER,
            fileKey: CONTAINER_KEY,
            sbomFileKey,
          }),
        ),
      ).resolves.toEqual({ accepted: true });
      expect(addResultsImportJob).toHaveBeenCalledWith({
        scanId: SCAN,
        projectId: PROJECT,
        organizationId: 'org-1',
        branch: 'main',
        category: 'sca',
        format: 'sarif',
        fileKey: CONTAINER_KEY,
        containerId: CONTAINER,
        sbomFileKey,
      });
    });

    it('refuses a container SBOM on another type, of another container, or as a SARIF key', async () => {
      process.env.CYBEDEFEND_EDITION = 'community';
      for (const bad of [
        request({
          vulnerabilityType: 'iac',
          containerId: CONTAINER,
          fileKey: CONTAINER_KEY,
          sbomFileKey: `import/${PROJECT}/${SCAN}/${CONTAINER}.sbom`,
        }),
        request({
          vulnerabilityType: 'sca',
          containerId: CONTAINER,
          fileKey: CONTAINER_KEY,
          sbomFileKey: `import/${PROJECT}/${SCAN}/${randomUUIDLike()}.sbom`,
        }),
        request({
          vulnerabilityType: 'sca',
          containerId: CONTAINER,
          fileKey: CONTAINER_KEY,
          sbomFileKey: CONTAINER_KEY,
        }),
      ]) {
        expect(await codeOf(controller.importResults(bad))).toEqual({
          code: status.INVALID_ARGUMENT,
          message: 'IMPORT_INVALID_REQUEST',
        });
      }
      expect(addResultsImportJob).not.toHaveBeenCalled();
    });

    it('takes the category from the request: a trivy-fs container imports as sca, a trivy-config one as iac', async () => {
      process.env.CYBEDEFEND_EDITION = 'community';
      for (const vulnerabilityType of ['sca', 'iac', 'secret', 'cicd']) {
        await expect(
          controller.importResults(
            request({
              containerId: CONTAINER,
              fileKey: CONTAINER_KEY,
              vulnerabilityType,
            }),
          ),
        ).resolves.toEqual({ accepted: true });
      }
      expect(
        addResultsImportJob.mock.calls.map(([data]) => data.category),
      ).toEqual(['sca', 'iac', 'secret', 'cicd']);
    });

    it('passes the severities to the job', async () => {
      await controller.importResults(
        request({
          containerId: CONTAINER,
          fileKey: CONTAINER_KEY,
          severities: 'critical,high',
        }),
      );
      await controller.importResults(request({ severities: 'low' }));
      // an empty value is no value, as for `image`: every severity is kept
      await controller.importResults(request({ severities: '' }));
      expect(addResultsImportJob.mock.calls[0][0].severities).toBe(
        'critical,high',
      );
      expect(addResultsImportJob.mock.calls[1][0].severities).toBe('low');
      expect(addResultsImportJob.mock.calls[2][0]).not.toHaveProperty(
        'severities',
      );
    });

    it('refuses severities outside critical|high|medium|low with IMPORT_INVALID_REQUEST', async () => {
      for (const severities of [
        'urgent',
        'high,urgent',
        'HIGH',
        'high,',
        ',high',
        'high, low',
        'high,,low',
        'info',
      ]) {
        expect(
          await codeOf(controller.importResults(request({ severities }))),
        ).toEqual({
          code: status.INVALID_ARGUMENT,
          message: 'IMPORT_INVALID_REQUEST',
        });
      }
      expect(addResultsImportJob).not.toHaveBeenCalled();
    });
  });

  it('answers UNAVAILABLE when the queue cannot be reached', async () => {
    addResultsImportJob.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const err = await codeOf(controller.importResults(request()));
    expect(err?.code).toBe(status.UNAVAILABLE);
    // the queue's own error text never reaches the caller
    expect(err?.message).not.toContain('ECONNREFUSED');
  });

  it('answers accepted for a repeated call, the queue keeping one job', async () => {
    // BullMQ answers the existing job for a duplicate jobId: nothing is
    // queued twice, and the caller still reads accepted.
    await controller.importResults(request());
    await expect(controller.importResults(request())).resolves.toEqual({
      accepted: true,
    });
  });
});
