import { ViolationController } from './violation.controller';
import { ViolationService } from './violation.service';

/**
 * Tenant isolation of violations.
 *
 * The controller must forward the project scope carried on the request so the
 * service can scope the query by tenant.
 */
describe('ViolationController - inter-org tenant isolation', () => {
  let controller: ViolationController;
  let violationService: { getScanViolations: jest.Mock };

  const scanId = 'ssssssss-ssss-ssss-ssss-ssssssssssss';
  const projectId = 'pppppppp-pppp-pppp-pppp-pppppppppppp';

  beforeEach(() => {
    violationService = {
      getScanViolations: jest
        .fn()
        .mockResolvedValue({ violations: [], total: 0, page: 1, pageSize: 20 }),
    };

    controller = new ViolationController(
      violationService as unknown as ViolationService,
    );
  });

  it('getScanViolations forwards projectId to the service for tenant scoping', async () => {
    await controller.getScanViolations({
      scanId,
      projectId,
      page: 1,
      pageSize: 20,
    });

    expect(violationService.getScanViolations).toHaveBeenCalledWith(
      scanId,
      projectId,
      1,
      20,
    );
  });
});
