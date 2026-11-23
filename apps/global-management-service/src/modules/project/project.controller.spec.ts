import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';

describe('ProjectController.markProjectAppsec', () => {
  it('hands the request to ProjectService.markProjectAppsec and returns its answer', async () => {
    const answer = {
      appsec: true,
      alreadyAppsec: false,
      limitReached: false,
      projectLimit: 10,
      appsecProjectCount: 4,
    };
    const projectService = {
      markProjectAppsec: jest.fn().mockResolvedValue(answer),
    } as unknown as ProjectService;
    const controller = new ProjectController(projectService);

    await expect(
      controller.markProjectAppsec({ projectId: 'p1' }),
    ).resolves.toEqual(answer);
    expect(projectService.markProjectAppsec).toHaveBeenCalledWith({
      projectId: 'p1',
    });
  });
});
