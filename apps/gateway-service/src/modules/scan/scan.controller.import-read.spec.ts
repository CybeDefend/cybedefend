import 'reflect-metadata';
import { ScanResponse } from '@grpc/security-scanning/scan';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { ProjectService } from 'src/modules/project/project.service';
import { Logger } from 'nestjs-pino';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';

const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCAN = '1f0b7c1e-9c1a-6a40-8000-000000000000';

/**
 * Scan read model: `GET /project/:projectId/scan/:scanId` hands an import
 * scan's fields to the client as security-scanning sent them, failure code
 * included.
 */
describe('ScanController.getScan — import scans', () => {
  it('passes the import fields through', async () => {
    const scan = {
      id: SCAN,
      projectId: PROJECT,
      state: 'failed',
      scanType: 'sast',
      importFormat: 'sarif',
      importTool: 'semgrep,codeql',
      errorMessage: 'IMPORT_INVALID_SARIF',
      errorCode: 70,
      errorCategory: 'import',
    } as unknown as ScanResponse;
    const scanService = { getScan: jest.fn(async () => scan) };
    const permissions = { checkPermission: jest.fn(async () => true) };
    const controller = new ScanController(
      scanService as unknown as ScanService,
      {} as ProjectService,
      { log: jest.fn() } as unknown as Logger,
      permissions as unknown as PermissionsGuard,
    );

    const body = await controller.getScan(
      { user: { sub: 'u1' } },
      PROJECT,
      SCAN,
    );

    expect(body).toMatchObject({
      importFormat: 'sarif',
      importTool: 'semgrep,codeql',
      errorMessage: 'IMPORT_INVALID_SARIF',
      errorCode: 70,
      errorCategory: 'import',
    });
    expect(permissions.checkPermission).toHaveBeenCalledWith(
      PROJECT,
      'project',
      'read_scan_result',
      'u1',
    );
  });
});
