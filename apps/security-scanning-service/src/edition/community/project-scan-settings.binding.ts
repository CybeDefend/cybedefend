import type { Provider } from '@nestjs/common';
import { PROJECT_SCAN_SETTINGS_PORT } from '../ports/project-scan-settings.port';
import { CommunityProjectScanSettings } from './project-scan-settings.community';

export const PROJECT_SCAN_SETTINGS_COMMUNITY_BINDINGS: Provider[] = [
  {
    provide: PROJECT_SCAN_SETTINGS_PORT,
    useClass: CommunityProjectScanSettings,
  },
];
