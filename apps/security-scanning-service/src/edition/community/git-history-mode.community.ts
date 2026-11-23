import type {
  GitHistoryMode,
  GitHistoryModePort,
} from '../ports/git-history-mode.port';

/** The Community Edition keeps the git history inside the source archive. */
export class CommunityGitHistoryMode implements GitHistoryModePort {
  mode(): GitHistoryMode {
    return 'in_archive';
  }
}
