import type { Provider } from '@nestjs/common';
import { PROJECT_SETTINGS_PORT } from '../ports/project-settings.port';
import { CommunityProjectSettings } from './project-settings.community';

export const PROJECT_SETTINGS_COMMUNITY_BINDINGS: Provider[] = [
  { provide: PROJECT_SETTINGS_PORT, useClass: CommunityProjectSettings },
];
