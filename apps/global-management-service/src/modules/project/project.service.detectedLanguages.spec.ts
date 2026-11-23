// global-management-service/src/modules/project/project.service.detectedLanguages.spec.ts
import { ProjectService } from './project.service';
import { CommunityProjectSettings } from 'src/edition/community/project-settings.community';

describe('ProjectService.mapToGrpcProject detectedLanguages', () => {
  it('maps detected languages onto the response (defaults to [])', () => {
    const service: any = Object.assign(
      Object.create(ProjectService.prototype),
      {
        projectSettings: new CommunityProjectSettings(),
      },
    );
    const proj: any = {
      id: 'p-1',
      name: 'demo',
      team: { id: 't', name: 'team', organization: { id: 'o', name: 'org' } },
    };

    const withLangs = service.mapToGrpcProject(
      proj,
      [],
      false,
      false,
      0,
      'none',
      undefined,
      false,
      '',
      ['Python', 'Go'],
    );
    expect(withLangs.detectedLanguages).toEqual(['Python', 'Go']);

    const withoutLangs = service.mapToGrpcProject(
      proj,
      [],
      false,
      false,
      0,
      'none',
      undefined,
      false,
      '',
    );
    expect(withoutLangs.detectedLanguages).toEqual([]);
  });
});
