import { buildOrganizationService } from './organization.service.fixtures';

/**
 * The organisation answers of the Community Edition carry the organisation's
 * identity and scan limit, never another field a row may hold (a closed
 * edition's own columns, the per-user diff-scan cap).
 */
const ROW = {
  id: 'o1',
  name: 'Org',
  industry: 'IT',
  country: 'FR',
  concurrentScanLimit: 2,
  diffScanMaxParallelPerUser: 5,
  // Any other column of the row, whatever its name.
  closedSetting: 'kept on the row',
};

const CORE_ANSWER = {
  id: 'o1',
  name: 'Org',
  industry: 'IT',
  country: 'FR',
  concurrentScanLimit: 2,
};

describe('OrganizationService answers (community)', () => {
  it('getOrganizationById answers the core fields only', async () => {
    const { service, orgRepo } = await buildOrganizationService();
    orgRepo.findOne!.mockResolvedValue(ROW);
    await expect(
      service.getOrganizationById({ organizationId: 'o1' }),
    ).resolves.toEqual(CORE_ANSWER);
  });

  it('getOrganizations answers the core fields only', async () => {
    const { service, orgRepo } = await buildOrganizationService();
    orgRepo.find!.mockResolvedValue([ROW]);
    await expect(service.getOrganizations({ userId: 'u1' })).resolves.toEqual([
      CORE_ANSWER,
    ]);
  });

  it('getOrganizationByProject answers the core fields only', async () => {
    const { service, projectRepo } = await buildOrganizationService();
    const project = { id: 'p1', team: { organization: ROW } };
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(project),
    };
    (projectRepo as any).createQueryBuilder = jest.fn(() => qb);
    await expect(service.getOrganizationByProject('p1')).resolves.toEqual(
      CORE_ANSWER,
    );
  });
});
