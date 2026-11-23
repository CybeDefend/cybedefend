import { Injectable } from '@nestjs/common';
import type { ProjectScanSettingsPort } from '../ports/project-scan-settings.port';

/** The community scan settings: the AppSec scanners only, no AI setting. */
@Injectable()
export class CommunityProjectScanSettings implements ProjectScanSettingsPort {
  extraScanTypes(): string[] {
    return [];
  }

  settingsFields(): Record<string, unknown> {
    return {};
  }
}
