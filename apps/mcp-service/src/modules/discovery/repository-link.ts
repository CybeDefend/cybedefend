import { GatewayClientService } from '../gateway-client/gateway-client.service';

/**
 * Link a freshly created project to its GitHub / GitLab repository through
 * the organization's integration.
 *
 * A project carries no repository: the link lives on the integration's
 * repository rows (`github_repositories.projectId`,
 * `gitlab_repositories.projectId`), which only the installed integration
 * creates. So the repository must already be in the integration, and the
 * link is by that row's id. Linking starts the first scan.
 *
 * Never rejects: once the project exists, the outcome is reported, not
 * thrown.
 */

export type RepositoryProvider = 'github' | 'gitlab';

export interface RepositoryRef {
  provider: RepositoryProvider;
  slug: string;
  host?: string;
}

export type RepositoryLinkStatus =
  | 'linked'
  | 'not_found'
  | 'already_linked'
  | 'forbidden'
  | 'unsupported_host'
  | 'failed';

export interface RepositoryLinkOutcome {
  provider: RepositoryProvider;
  slug: string;
  status: RepositoryLinkStatus;
  message: string;
  /** The project the repository is already linked to (`already_linked`). */
  linkedProjectId?: string;
}

/**
 * The only hosts the integrations cover: the GitHub App on github.com, the
 * GitLab OAuth integration hard-wired to gitlab.com. `resolve` has the same
 * limits.
 */
export const SAAS_HOSTS: Record<RepositoryProvider, string> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
};

const LABEL: Record<RepositoryProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
};

/** The SSH-over-443 hosts of the two forges, folded onto their SaaS host. */
const HOST_ALIASES: Record<string, string> = {
  'ssh.github.com': 'github.com',
  'altssh.gitlab.com': 'gitlab.com',
};

const HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * Reduce what an agent may pass as a remote host (`https://github.com`,
 * `git@github.com`, `github.com:443`, `GitHub.com`) to a bare lowercase
 * hostname, with the SSH-over-443 hosts folded onto their SaaS host. `null`
 * when nothing host-like remains.
 */
export function normalizeHost(raw: string): string | null {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme
    .replace(/\/.*$/, '') // path
    .replace(/^[^@]*@/, '') // userinfo
    .replace(/:\d*$/, ''); // port
  if (!HOSTNAME_RE.test(host)) return null;
  return HOST_ALIASES[host] ?? host;
}

export interface IntegrationRepository {
  id: string;
  path: string;
  projectId: string;
}

/** The free integration row to link, or the outcome that stops the link. */
export type RepositoryLookup =
  | { match: IntegrationRepository }
  | { outcome: RepositoryLinkOutcome };

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function toRepository(raw: unknown, pathKey: string): IntegrationRepository {
  const o = (raw ?? {}) as Record<string, unknown>;
  return { id: str(o.id), path: str(o[pathKey]), projectId: str(o.projectId) };
}

/**
 * GitHub answers `{ repositories: [{ installationId, repository: [...] }] }`
 * (one entry per App installation), GitLab `{ repositories: [...] }`. The
 * Gateway's gRPC loader camel-cases the fields; `projectId` is `''` when the
 * row is free.
 */
function readRepositories(
  provider: RepositoryProvider,
  body: unknown,
): IntegrationRepository[] {
  const list = (body as { repositories?: unknown } | null)?.repositories;
  if (!Array.isArray(list)) return [];
  if (provider === 'gitlab') {
    return list.map((r) => toRepository(r, 'pathWithNamespace'));
  }
  return list.flatMap((installation) => {
    const repos = (installation as { repository?: unknown } | null)?.repository;
    return Array.isArray(repos)
      ? repos.map((r) => toRepository(r, 'fullName'))
      : [];
  });
}

function statusOf(e: unknown): number | undefined {
  const status = (e as { response?: { status?: unknown } } | null)?.response
    ?.status;
  return typeof status === 'number' ? status : undefined;
}

function messageOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String(e);
}

/**
 * The Gateway's message for a 4xx; for a 5xx or no answer, only the status.
 * Like `mapErrorToPayload`, never echo upstream internals.
 */
function describeFailure(e: unknown): string {
  const status = statusOf(e);
  if (status !== undefined && status >= 400 && status < 500) {
    return messageOf(e);
  }
  return status !== undefined ? `HTTP ${status}` : 'no answer from the gateway';
}

function makeOutcome(
  repository: RepositoryRef,
  status: RepositoryLinkStatus,
  message: string,
  linkedProjectId?: string,
): RepositoryLinkOutcome {
  return {
    provider: repository.provider,
    slug: repository.slug,
    status,
    message,
    ...(linkedProjectId ? { linkedProjectId } : {}),
  };
}

function forbiddenOutcome(repository: RepositoryRef): RepositoryLinkOutcome {
  return makeOutcome(
    repository,
    'forbidden',
    'Linking needs the integration-management right on the organization ' +
      '(organization creator, administrator or manager). Ask one of them to ' +
      `link ${repository.slug} to this project from the dashboard.`,
  );
}

/**
 * Find the repository in the organization's integration, without linking
 * anything: the free row to link, or the outcome that stops the link.
 * `create_project` calls it before creating, to refuse a repository that is
 * already linked. Never rejects.
 */
export async function lookupRepository(
  gateway: GatewayClientService,
  organizationId: string,
  repository: RepositoryRef,
  accessToken: string,
): Promise<RepositoryLookup> {
  const { provider, slug } = repository;
  const label = LABEL[provider];

  const host = repository.host
    ? normalizeHost(repository.host)
    : SAAS_HOSTS[provider];
  if (host !== SAAS_HOSTS[provider]) {
    return {
      outcome: makeOutcome(
        repository,
        'unsupported_host',
        `${host ?? repository.host} is not supported: the CybeDefend ${label} ` +
          `integration only covers ${SAAS_HOSTS[provider]}.`,
      ),
    };
  }

  let repositories: IntegrationRepository[];
  try {
    const body =
      provider === 'github'
        ? await gateway.listGithubRepositories(organizationId, accessToken)
        : await gateway.listGitlabRepositories(organizationId, accessToken);
    repositories = readRepositories(provider, body);
  } catch (e) {
    if (statusOf(e) === 403) return { outcome: forbiddenOutcome(repository) };
    return {
      outcome: makeOutcome(
        repository,
        'failed',
        `Could not list the organization's ${label} repositories (${describeFailure(e)}).`,
      ),
    };
  }

  const wanted = slug.toLowerCase();
  const matches = repositories.filter((r) => r.path.toLowerCase() === wanted);
  if (matches.length === 0) {
    return {
      outcome: makeOutcome(
        repository,
        'not_found',
        provider === 'github'
          ? `${slug} is not in the organization's GitHub integration: install the ` +
              'CybeDefend GitHub App on its owner and give it access to this ' +
              'repository, then link the project from the dashboard.'
          : `${slug} is not in the organization's GitLab integration: connect GitLab ` +
              "from the dashboard's integrations with an account that can see this " +
              'repository, then link the project from the dashboard.',
      ),
    };
  }
  if (matches.length > 1) {
    return {
      outcome: makeOutcome(
        repository,
        'failed',
        `Several ${label} repositories named ${slug} are in the integration: ` +
          'link the right one from the dashboard.',
      ),
    };
  }

  const [match] = matches;
  if (match.projectId) {
    // GitLab would overwrite the other project's link without a word.
    return {
      outcome: makeOutcome(
        repository,
        'already_linked',
        `${slug} is already linked to project ${match.projectId} and was not ` +
          'relinked: use that project, or unlink it from the dashboard first.',
        match.projectId,
      ),
    };
  }
  return { match };
}

export async function linkRepositoryToProject(
  gateway: GatewayClientService,
  target: { organizationId: string; projectId: string },
  repository: RepositoryRef,
  accessToken: string,
): Promise<RepositoryLinkOutcome> {
  const { provider, slug } = repository;
  const found = await lookupRepository(
    gateway,
    target.organizationId,
    repository,
    accessToken,
  );
  if ('outcome' in found) return found.outcome;
  const { match } = found;

  try {
    if (provider === 'github') {
      await gateway.linkGithubRepository(
        target.organizationId,
        target.projectId,
        match.id,
        accessToken,
      );
    } else {
      await gateway.linkGitlabRepository(
        target.organizationId,
        target.projectId,
        match.id,
        accessToken,
      );
    }
  } catch (e) {
    if (statusOf(e) === 403) return forbiddenOutcome(repository);
    return makeOutcome(
      repository,
      'failed',
      `Could not link ${slug} (${describeFailure(e)}).`,
    );
  }
  return makeOutcome(
    repository,
    'linked',
    `${slug} is linked to the project; the first scan of its default branch has started.`,
  );
}
