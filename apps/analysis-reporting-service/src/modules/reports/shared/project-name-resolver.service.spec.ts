import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { ProjectNameResolver } from './project-name-resolver.service';

describe('ProjectNameResolver', () => {
  let resolver: ProjectNameResolver;
  let projectServiceMock: { get: jest.Mock };

  async function build(getImpl: jest.Mock): Promise<ProjectNameResolver> {
    projectServiceMock = { get: getImpl };
    const globalClientMock = {
      getService: jest.fn().mockReturnValue(projectServiceMock),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectNameResolver,
        { provide: 'GLOBAL_MANAGEMENT_SERVICE', useValue: globalClientMock },
      ],
    }).compile();
    return module.get(ProjectNameResolver);
  }

  it('resolves the human-readable project name via ProjectService.Get', async () => {
    resolver = await build(
      jest.fn().mockReturnValue(of({ name: 'My Project' })),
    );

    await expect(resolver.resolve('p1')).resolves.toBe('My Project');
  });

  // A report header only needs the project name, a column of the
  // project row. The lean read skips the vulnerability stats, the integration
  // status and the security context.
  it('asks for the lean read', async () => {
    resolver = await build(
      jest.fn().mockReturnValue(of({ name: 'My Project' })),
    );

    await resolver.resolve('p1');

    expect(projectServiceMock.get).toHaveBeenCalledTimes(1);
    expect(projectServiceMock.get).toHaveBeenCalledWith({
      projectId: 'p1',
      skipVulnerabilityStats: true,
      skipIntegrationStatus: true,
      skipSecurityContext: true,
    });
  });

  it('returns undefined when the project has no name', async () => {
    resolver = await build(jest.fn().mockReturnValue(of({ name: '' })));

    await expect(resolver.resolve('p1')).resolves.toBeUndefined();
  });

  it('fails soft (returns undefined) when the gRPC call throws', async () => {
    resolver = await build(
      jest.fn().mockReturnValue(throwError(() => new Error('UNAVAILABLE'))),
    );

    await expect(resolver.resolve('p1')).resolves.toBeUndefined();
  });
});
