// gateway-service/src/modules/project/project.service.codeGraphSupported.spec.ts
import { of } from 'rxjs';

import { ProjectService } from './project.service';

describe('ProjectService.getProject codeGraphSupported', () => {
  const makeService = (detectedLanguages: string[]) => {
    const grpcStub = {
      get: jest.fn().mockReturnValue(
        of({
          projectId: 'p-1',
          parsedBranches: [],
          referenceBranch: undefined,
          detectedLanguages,
        }),
      ),
    } as any;

    const clientMock = {
      getService: jest.fn().mockReturnValue(grpcStub),
    } as any;

    // analysis-reporting is not read by getProject.
    const service = new ProjectService(clientMock, {
      getService: jest.fn().mockReturnValue({}),
    } as any);
    service.onModuleInit();
    return service;
  };

  it('derives codeGraphSupported=false when only unsupported languages are detected', async () => {
    const service = makeService(['Terraform']);
    const res = await service.getProject({ projectId: 'p-1' });
    expect(res.codeGraphSupported).toBe(false);
    expect(res.detectedLanguages).toEqual(['Terraform']);
  });

  it('derives codeGraphSupported=true for a supported language', async () => {
    const service = makeService(['Python', 'Terraform']);
    const res = await service.getProject({ projectId: 'p-1' });
    expect(res.codeGraphSupported).toBe(true);
  });

  it('is optimistic (true) when no language detected', async () => {
    const service = makeService([]);
    const res = await service.getProject({ projectId: 'p-1' });
    expect(res.codeGraphSupported).toBe(true);
  });
});
