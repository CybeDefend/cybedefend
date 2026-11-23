import { Injectable } from '@nestjs/common';
import type { Project } from 'src/entities/project.entity';
import type { ProjectSettingsPort } from '../ports/project-settings.port';

/**
 * The community project settings: AppSec is the only product, and no closed
 * feature has a setting to store or answer.
 */
@Injectable()
export class CommunityProjectSettings implements ProjectSettingsPort {
  products(): readonly string[] {
    return ['appsec'];
  }

  creationColumns(): Partial<Project> {
    return {};
  }

  updateColumns(): Partial<Project> {
    return {};
  }

  answerFields(): Record<string, unknown> {
    return {};
  }

  listFields(): Record<string, unknown> {
    return {};
  }

  summarySelects(): ReadonlyArray<readonly [string, string]> {
    return [];
  }

  summaryFields(): Record<string, unknown> {
    return {};
  }
}
