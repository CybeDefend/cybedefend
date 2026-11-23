import type { Provider } from '@nestjs/common';
import { GIT_HISTORY_MODE_PORT } from '../ports/git-history-mode.port';
import { CommunityGitHistoryMode } from './git-history-mode.community';

export const GIT_HISTORY_MODE_COMMUNITY_BINDINGS: Provider[] = [
  { provide: GIT_HISTORY_MODE_PORT, useClass: CommunityGitHistoryMode },
];
