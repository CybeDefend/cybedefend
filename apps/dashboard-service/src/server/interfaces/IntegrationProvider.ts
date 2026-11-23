/**
 * Integration provider types and interfaces for generic integration pages
 */

export type IntegrationProvider = 'github' | 'gitlab';

export interface Repository {
  id: string;
  name: string;
  fullName: string;
  nameWithNamespace: string;
  projectId?: string | null;
}

export interface IntegrationHook {
  repositories: Repository[];
  isLoadingRepositories: boolean;
  linkRepository: (projectId: string, repositoryId: string) => Promise<void>;
  isLinkingRepository: boolean;
  error?: string | null;
  refetchRepositories?: () => void;
  isLinked?: boolean;
  isLoadingInstallation?: boolean;
}

export interface IntegrationPageConfig {
  provider: IntegrationProvider;
  icon: React.ReactNode;
  translationKey: string;
  backToPath: string;
}
