import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { of, throwError } from 'rxjs';
import { status } from '@grpc/grpc-js';

import { OrphanIntegrationsCleanupService } from './orphan-integrations-cleanup.service';
import { IntegrationsAdminService } from './integrations-admin.service';
import { createLoggerMock } from '../../test-utils/mocks';

describe('OrphanIntegrationsCleanupService', () => {
  let service: OrphanIntegrationsCleanupService;
  let listOrganizationIdsWithIntegrations: jest.Mock;
  let deleteIntegrationsForOrg: jest.Mock;
  let getOrganization: jest.Mock;

  const notFound = () =>
    throwError(() =>
      Object.assign(new Error('Organization not found'), {
        code: status.NOT_FOUND,
      }),
    );

  const unavailable = () =>
    throwError(() =>
      Object.assign(new Error('global-management is down'), {
        code: status.UNAVAILABLE,
      }),
    );

  beforeEach(async () => {
    listOrganizationIdsWithIntegrations = jest.fn().mockResolvedValue([]);
    deleteIntegrationsForOrg = jest.fn().mockResolvedValue({ jira: 1 });
    getOrganization = jest.fn(() => of({ id: 'org-a', name: 'Org A' }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrphanIntegrationsCleanupService,
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: IntegrationsAdminService,
          useValue: {
            listOrganizationIdsWithIntegrations,
            deleteIntegrationsForOrg,
          },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({ get: getOrganization }) },
        },
      ],
    }).compile();

    service = module.get(OrphanIntegrationsCleanupService);
    service.onModuleInit();
  });

  it('deletes the integrations of an organization global-management no longer knows', async () => {
    listOrganizationIdsWithIntegrations.mockResolvedValue(['org-gone']);
    getOrganization.mockImplementation(() => notFound());

    const result = await service.run({ apply: true });

    expect(deleteIntegrationsForOrg).toHaveBeenCalledWith(
      'org-gone',
      IntegrationsAdminService.ALL_TYPES,
    );
    expect(result).toMatchObject({
      scanned: 1,
      orphans: ['org-gone'],
      deleted: ['org-gone'],
      skipped: [],
    });
  });

  it('leaves the integrations of a live organization alone', async () => {
    listOrganizationIdsWithIntegrations.mockResolvedValue(['org-a']);

    const result = await service.run({ apply: true });

    expect(deleteIntegrationsForOrg).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 1, orphans: [], deleted: [] });
  });

  // Safety net: treating a transient gRPC failure as "the org is gone" would
  // wipe the integrations of a live organization.
  it('never deletes when the existence check fails with anything but NOT_FOUND', async () => {
    listOrganizationIdsWithIntegrations.mockResolvedValue(['org-a']);
    getOrganization.mockImplementation(() => unavailable());

    const result = await service.run({ apply: true });

    expect(deleteIntegrationsForOrg).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      scanned: 1,
      orphans: [],
      deleted: [],
      skipped: ['org-a'],
    });
  });

  it('reports orphans without deleting anything when apply is false', async () => {
    listOrganizationIdsWithIntegrations.mockResolvedValue(['org-gone']);
    getOrganization.mockImplementation(() => notFound());

    const result = await service.run({ apply: false });

    expect(deleteIntegrationsForOrg).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      scanned: 1,
      orphans: ['org-gone'],
      deleted: [],
    });
  });

  // A global-management pointed at the wrong (or freshly migrated) database
  // answers NOT_FOUND for every organization, which the per-org guard cannot
  // tell apart from a genuine orphan. The blast-radius cap is what stops that
  // misconfiguration from wiping every customer's integrations in one pass.
  it('deletes nothing when the orphan count exceeds the blast-radius cap', async () => {
    listOrganizationIdsWithIntegrations.mockResolvedValue([
      'org-1',
      'org-2',
      'org-3',
    ]);
    getOrganization.mockImplementation(() => notFound());

    const result = await service.run({ apply: true, maxDeletions: 2 });

    expect(deleteIntegrationsForOrg).not.toHaveBeenCalled();
    expect(result.orphans).toHaveLength(3);
    expect(result.deleted).toEqual([]);
    expect(result.abortedReason).toMatch(/3 orphan/);
  });

  it('deletes when the orphan count is within the cap', async () => {
    listOrganizationIdsWithIntegrations.mockResolvedValue(['org-1', 'org-2']);
    getOrganization.mockImplementation(() => notFound());

    const result = await service.run({ apply: true, maxDeletions: 2 });

    expect(deleteIntegrationsForOrg).toHaveBeenCalledTimes(2);
    expect(result.deleted).toEqual(['org-1', 'org-2']);
    expect(result.abortedReason).toBeUndefined();
  });

  it('keeps sweeping the remaining orphans when one deletion throws', async () => {
    listOrganizationIdsWithIntegrations.mockResolvedValue([
      'org-gone-1',
      'org-gone-2',
    ]);
    getOrganization.mockImplementation(() => notFound());
    deleteIntegrationsForOrg.mockRejectedValueOnce(new Error('db down'));

    const result = await service.run({ apply: true });

    expect(deleteIntegrationsForOrg).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      orphans: ['org-gone-1', 'org-gone-2'],
      deleted: ['org-gone-2'],
      skipped: ['org-gone-1'],
    });
  });
});
