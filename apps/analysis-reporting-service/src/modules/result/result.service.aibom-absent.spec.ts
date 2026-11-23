import { ResultService } from './result.service';
import { makeEmptyRepository } from '../../test-utils/project-lookup.harness';

/**
 * AIBOM_INVENTORY is an optional extension token, supplied only by
 * the ee AibomModule. Without it (the Community Edition) the tab counts
 * report no AI-BOM component and a project delete still removes every core
 * detection, without touching the closed AI-BOM tables.
 */
describe('ResultService without the AI-BOM extension', () => {
  const PROJECT_ID = 'p1';

  function deletable() {
    return { ...makeEmptyRepository(), delete: jest.fn(async () => undefined) };
  }

  /** A ResultService built with no AIBOM_INVENTORY provider. */
  function serviceWithoutAibom() {
    const repos = {
      sastVulnDetectRepository: deletable(),
      iacVulnDetectRepository: deletable(),
      cicdVulnDetectRepository: deletable(),
      secretVulnDetectRepository: deletable(),
      scaVulnDetectRepository: deletable(),
      containerVulnDetectRepository: deletable(),
      scaDetectedPackageRepository: deletable(),
      containerDetectedImageRepository: deletable(),
      containerDetectedPackageRepository: deletable(),
    };
    const service = Object.assign(
      Object.create(ResultService.prototype) as object,
      repos,
    ) as unknown as ResultService;
    return { service, repos };
  }

  it('counts 0 AI-BOM components without the extension', async () => {
    const { service } = serviceWithoutAibom();

    const counts = await service.getCountVulnerabilitiesCountByType(
      PROJECT_ID,
      'main',
      ['main', ''],
    );

    expect(counts.aibom).toBe(0);
  });

  it('deletes the detections of a project without the extension', async () => {
    const { service, repos } = serviceWithoutAibom();

    await expect(
      service.deleteProjectVulnerabilityDetections({
        projectId: PROJECT_ID,
        organizationId: 'o1',
      }),
    ).resolves.toEqual({
      message: 'Project vulnerability detections deleted successfully',
    });

    for (const repo of [
      repos.sastVulnDetectRepository,
      repos.iacVulnDetectRepository,
      repos.scaVulnDetectRepository,
      repos.containerVulnDetectRepository,
      repos.scaDetectedPackageRepository,
      repos.containerDetectedImageRepository,
      repos.containerDetectedPackageRepository,
    ]) {
      expect(repo.delete).toHaveBeenCalledWith({ projectId: PROJECT_ID });
    }
  });
});
