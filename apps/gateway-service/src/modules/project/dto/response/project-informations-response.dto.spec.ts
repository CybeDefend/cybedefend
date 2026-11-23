import 'reflect-metadata';
import { ProjectInformationsResponseDto } from './project-informations-response.dto';

/** The core project answer documents no setting of a closed feature. */
describe('ProjectInformationsResponseDto', () => {
  it.each([
    'aibomEnabled',
    'aiMergeRequestEnabled',
    'improvingResultsEnabled',
    'sortsVulnerabilitiesEnabled',
  ])('documents no %s', (field) => {
    const properties: string[] =
      Reflect.getMetadata(
        'swagger/apiModelPropertiesArray',
        ProjectInformationsResponseDto.prototype,
      ) ?? [];
    expect(properties).not.toContain(`:${field}`);
  });
});
