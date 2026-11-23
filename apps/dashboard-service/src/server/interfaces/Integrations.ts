export interface InstallGithubIntegrationDto {
    code: string;
    installationId: number;
    state: string;
  }

  
  export interface GithubRepository {
    id: string;
    githubId: number;
    nodeId: string;
    name: string;
    fullName: string;
    private: boolean;
    projectId: string | null;
    defaultBranch?: string;
    scanBranch?: string;
  }
  
  export interface GithubInstallation {
    installationId: number;
    repository: GithubRepository[];
  }
  
  export interface GithubRepositoriesResponse {
    repositories: GithubInstallation[];
    organizationId: string;
  }
  
  export interface LinkRepositoryDto {
    repositoryId: string;
    /**
     * The space the repository is linked from (a product id). From another
     * space than AppSec the link builds the code graph only, with no AppSec
     * scan. Absent: AppSec, as before.
     */
    product?: string;
  }

  // Details returned by GET /organization/:organizationId/github/installation
  export interface GithubInstallationDetails {
    id: string;
    installationId: number;
    userId: string;
    organizationId: string;
    createdAt: string;
    updatedAt: string;
  }
  