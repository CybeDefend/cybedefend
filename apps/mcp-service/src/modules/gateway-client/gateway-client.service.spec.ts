import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

import { GatewayClientService } from './gateway-client.service';
import type { GatewayErrorTranslator } from '../../edition/ports/gateway-error-translator.port';

/**
 * Unit specs for {@link GatewayClientService}.
 *
 * We swap the private `http` AxiosInstance with a `jest.fn`-backed stub so we
 * can inspect every request without needing axios-mock-adapter (not a
 * devDependency here). The shape of the mock matches the methods the
 * service actually uses: `.post(...)`, `.get(...)`, `.patch(...)`.
 */

function makeLogger(): Logger {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeConfig(resource: string | undefined): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'CYBEDEFEND_API_RESOURCE') return resource;
      return undefined;
    }),
  } as unknown as ConfigService;
}

/** Flexible response shape covering both simple `{data}` and full `{status, data, headers}` responses. */
type HttpStubResponse = {
  data: unknown;
  status?: number;
  headers?: Record<string, string>;
};
type HttpStub = jest.Mock<Promise<HttpStubResponse>, unknown[]>;

interface HttpStubBag {
  get: HttpStub;
  post: HttpStub;
  patch: HttpStub;
  put: HttpStub;
  delete: HttpStub;
}

/**
 * Build a `GatewayClientService` whose internal AxiosInstance is replaced by
 * a stub exposing `.get`, `.post`, `.patch`, and `.delete`. We cast through
 * `unknown` to bypass the readonly declaration on the private property — this
 * keeps the production API surface intact while giving the test full control
 * over HTTP behaviour.
 */
function buildServiceWithHttpStub(resource = 'http://gateway.local'): {
  service: GatewayClientService;
  http: HttpStubBag;
  logger: Logger;
} {
  const logger = makeLogger();
  const service = new GatewayClientService(makeConfig(resource), logger);
  const http: HttpStubBag = {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  };
  (service as unknown as { http: HttpStubBag }).http = http;
  return { service, http, logger };
}

describe('GatewayClientService', () => {
  describe('constructor', () => {
    it('throws when CYBEDEFEND_API_RESOURCE is missing', () => {
      expect(
        () => new GatewayClientService(makeConfig(undefined), makeLogger()),
      ).toThrow(/CYBEDEFEND_API_RESOURCE/);
    });

    it('constructs successfully when CYBEDEFEND_API_RESOURCE is provided', () => {
      expect(
        () =>
          new GatewayClientService(
            makeConfig('http://gateway.local'),
            makeLogger(),
          ),
      ).not.toThrow();
    });
  });

  describe('error translator port', () => {
    function buildWithTranslator(errorTranslator?: GatewayErrorTranslator): {
      service: GatewayClientService;
      http: HttpStubBag;
      logger: Logger;
    } {
      const logger = makeLogger();
      const service = new GatewayClientService(
        makeConfig('http://gateway.local'),
        logger,
        errorTranslator,
      );
      const http: HttpStubBag = {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
      };
      (service as unknown as { http: HttpStubBag }).http = http;
      return { service, http, logger };
    }

    it("returns the translator's error when it recognises the failure", async () => {
      const sentinel = new Error('translated by the port');
      const { service, http, logger } = buildWithTranslator({
        translate: (_e, warn) => {
          warn('X');
          return sentinel;
        },
      });
      http.get.mockRejectedValueOnce({ response: { status: 402 } });

      const error = await service
        .listOrganizations('t')
        .catch((e: unknown) => e);

      expect(error).toBe(sentinel);
      expect(logger.warn).toHaveBeenCalledWith(
        'GatewayClient.listOrganizations failed: X',
      );
    });

    it('wraps as before when the translator answers null', async () => {
      const { service, http } = buildWithTranslator({ translate: () => null });
      http.get.mockRejectedValueOnce({
        response: { status: 404, data: { message: 'nope' } },
      });

      const error = await service
        .listOrganizations('t')
        .catch((e: unknown) => e);

      expect((error as Error).message).toBe('nope');
      expect(
        (error as { response?: { status?: number } }).response?.status,
      ).toBe(404);
    });

    it('wraps as before without a translator', async () => {
      const { service, http } = buildWithTranslator();
      http.get.mockRejectedValueOnce({
        response: { status: 404, data: { message: 'nope' } },
      });

      const error = await service
        .listOrganizations('t')
        .catch((e: unknown) => e);

      expect((error as Error).message).toBe('nope');
      expect(
        (error as { response?: { status?: number } }).response?.status,
      ).toBe(404);
    });
  });

  describe('refusals by the gateway', () => {
    it('keeps the validation message of a 400, joined and bounded, for the agent', async () => {
      const { service, http, logger } = buildServiceWithHttpStub();
      http.get.mockRejectedValueOnce({
        response: {
          status: 400,
          data: { message: ['page must not be less than 1', 'x'.repeat(2000)] },
        },
      });

      const error = (await service
        .listVulnerabilities('p', 'sast', {}, 't')
        .catch((e: unknown) => e)) as { validationMessage?: string };

      expect(error.validationMessage).toMatch(
        /^page must not be less than 1; x+/,
      );
      expect(error.validationMessage!.length).toBeLessThanOrEqual(500);
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('keeps no validation message outside a 400 or 422', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockRejectedValueOnce({
        response: { status: 403, data: { message: 'Forbidden resource' } },
      });

      const error = (await service
        .listVulnerabilities('p', 'sast', {}, 't')
        .catch((e: unknown) => e)) as { validationMessage?: string };

      expect(error.validationMessage).toBeUndefined();
    });

    it('logs a gateway failure (5xx or no answer) as an error', async () => {
      const { service, http, logger } = buildServiceWithHttpStub();
      http.get.mockRejectedValueOnce({ response: { status: 503 } });
      await service.listOrganizations('t').catch(() => undefined);
      http.get.mockRejectedValueOnce({ code: 'ECONNREFUSED', message: 'x' });
      await service.listOrganizations('t').catch(() => undefined);

      expect(logger.error).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * Common coverage for the 7 vulnerability-result proxies added to support
   * the ported STDIO tools. We focus on three invariants each:
   *  1. The exact URL + verb + query shape hits axios.
   *  2. The Bearer token is forwarded in the Authorization header.
   *  3. Error responses bubble up as the upstream `message`.
   *
   * We deliberately do NOT assert the returned JSON shape per method — the
   * gateway is the source of truth and the service just pipes `data`. That
   * pass-through is verified once below.
   */
  describe('getProjectOverview', () => {
    it('GETs /project/<id>/results/overview with comma-joined branches', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockResolvedValueOnce({ data: { totals: {} } });

      const result = await service.getProjectOverview(
        'p-1',
        ['main', 'develop'],
        'tok',
      );

      expect(http.get).toHaveBeenCalledTimes(1);
      const [url, cfg] = http.get.mock.calls[0] as [
        string,
        {
          headers: { Authorization: string };
          params?: Record<string, unknown>;
        },
      ];
      expect(url).toBe('/project/p-1/results/overview');
      expect(cfg.params).toEqual({ branches: 'main,develop' });
      expect(cfg.headers.Authorization).toBe('Bearer tok');
      expect(result).toEqual({ totals: {} });
    });

    it('omits params when branches is empty or undefined', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockResolvedValue({ data: {} });

      await service.getProjectOverview('p', undefined, 'tok');
      await service.getProjectOverview('p', [], 'tok');

      for (const call of http.get.mock.calls) {
        const cfg = call[1] as { params?: unknown };
        expect(cfg.params).toBeUndefined();
      }
    });

    it('throws the upstream message on axios failure', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockRejectedValueOnce(
        Object.assign(new Error('oops'), {
          response: { data: { message: 'bad branch' } },
        }),
      );

      await expect(
        service.getProjectOverview('p', undefined, 'tok'),
      ).rejects.toThrow('bad branch');
    });
  });

  describe('getBranches', () => {
    it('GETs /project/<id>/branches with Bearer auth', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockResolvedValueOnce({ data: ['main', 'develop'] });

      const result = await service.getBranches('p-1', 'tok');

      expect(http.get).toHaveBeenCalledTimes(1);
      const [url, cfg] = http.get.mock.calls[0] as [
        string,
        { headers: { Authorization: string }; params?: unknown },
      ];
      expect(url).toBe('/project/p-1/branches');
      expect(cfg.params).toBeUndefined();
      expect(cfg.headers.Authorization).toBe('Bearer tok');
      expect(result).toEqual(['main', 'develop']);
    });

    it('throws upstream message on failure', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockRejectedValueOnce(
        Object.assign(new Error('boom'), {
          response: { data: { message: 'forbidden' } },
        }),
      );

      await expect(service.getBranches('p', 'tok')).rejects.toThrow(
        'forbidden',
      );
    });
  });

  describe('listVulnerabilities', () => {
    it.each(['sast', 'sca', 'iac', 'cicd', 'secret', 'container'] as const)(
      'GETs /mcp/project/<id>/results/%s and forwards query params verbatim (minus null/undefined)',
      async (scanner) => {
        const { service, http } = buildServiceWithHttpStub();
        http.get.mockResolvedValueOnce({ data: { items: [] } });

        const result = await service.listVulnerabilities(
          'p-1',
          scanner,
          {
            severity: ['high'],
            branch: 'main',
            dropMe: undefined,
            alsoDrop: null,
          },
          'tok',
        );

        expect(http.get).toHaveBeenCalledTimes(1);
        const [url, cfg] = http.get.mock.calls[0] as [
          string,
          {
            headers: { Authorization: string };
            params?: Record<string, unknown>;
          },
        ];
        expect(url).toBe(`/mcp/project/p-1/results/${scanner}`);
        expect(cfg.params).toEqual({ severity: ['high'], branch: 'main' });
        expect(cfg.headers.Authorization).toBe('Bearer tok');
        expect(result).toEqual({ items: [] });
      },
    );

    it('passes params=undefined when query is empty after pruning', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockResolvedValueOnce({ data: {} });

      await service.listVulnerabilities('p', 'sast', {}, 'tok');

      const cfg = http.get.mock.calls[0][1] as { params?: unknown };
      expect(cfg.params).toBeUndefined();
    });

    it('throws upstream message on failure', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockRejectedValueOnce(
        Object.assign(new Error('x'), {
          response: { data: { message: 'list failed' } },
        }),
      );

      await expect(
        service.listVulnerabilities('p', 'sast', {}, 'tok'),
      ).rejects.toThrow('list failed');
    });
  });

  describe('getVulnerability', () => {
    it.each(['sast', 'sca', 'iac', 'cicd', 'secret', 'container'] as const)(
      'GETs /mcp/project/<id>/results/%s/<vid> with url-encoded ids',
      async (scanner) => {
        const { service, http } = buildServiceWithHttpStub();
        http.get.mockResolvedValueOnce({ data: { id: 'v-1' } });

        const result = await service.getVulnerability(
          'proj with space',
          scanner,
          'v/weird',
          'tok',
        );

        const [url, cfg] = http.get.mock.calls[0] as [
          string,
          { headers: { Authorization: string } },
        ];
        expect(url).toBe(
          `/mcp/project/${encodeURIComponent('proj with space')}/results/${scanner}/${encodeURIComponent('v/weird')}`,
        );
        expect(cfg.headers.Authorization).toBe('Bearer tok');
        expect(result).toEqual({ id: 'v-1' });
      },
    );

    it('throws upstream message on failure', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockRejectedValueOnce(
        Object.assign(new Error('x'), {
          response: { data: { message: 'not found' } },
        }),
      );

      await expect(
        service.getVulnerability('p', 'sast', 'v', 'tok'),
      ).rejects.toThrow('not found');
    });
  });

  describe('updateVulnerability', () => {
    it('PATCHes /project/<id>/results/<vid> with the body and Bearer auth', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.patch.mockResolvedValueOnce({ data: { ok: true } });

      const result = await service.updateVulnerability(
        'p-1',
        'v-1',
        { status: 'resolved', comment: 'fixed' },
        'tok',
      );

      expect(http.patch).toHaveBeenCalledTimes(1);
      const [url, body, cfg] = http.patch.mock.calls[0] as [
        string,
        unknown,
        { headers: { Authorization: string } },
      ];
      expect(url).toBe('/project/p-1/results/v-1');
      expect(body).toEqual({ status: 'resolved', comment: 'fixed' });
      expect(cfg.headers.Authorization).toBe('Bearer tok');
      expect(result).toEqual({ ok: true });
    });

    it('throws upstream message on failure', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.patch.mockRejectedValueOnce(
        Object.assign(new Error('x'), {
          response: { data: { message: 'update failed' } },
        }),
      );

      await expect(
        service.updateVulnerability('p', 'v', {}, 'tok'),
      ).rejects.toThrow('update failed');
    });
  });

  describe('proto3 optional presence-marker stripping (_x)', () => {
    it('drops `_field: "field"` markers recursively (objects + arrays)', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockResolvedValueOnce({
        data: {
          branch: 'dev',
          _branch: 'branch',
          cvss3: { baseScore: '5' },
          _cvss3: 'cvss3',
          cvssExplanation: {
            drivers: [{ baseKey: 'AV', _baseKey: 'baseKey' }],
            _drivers: 'drivers',
          },
        },
      });

      const result = await service.getBranches('p', 'tok');

      expect(result).toEqual({
        branch: 'dev',
        cvss3: { baseScore: '5' },
        cvssExplanation: {
          drivers: [{ baseKey: 'AV' }],
        },
      });
    });

    it('keeps real oneof keys (no leading underscore) and `_k` whose value != k', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockResolvedValueOnce({
        data: { vulnerability: 'sast', _note: 'something else', _x: 'y' },
      });

      const result = await service.getBranches('p', 'tok');

      expect(result).toEqual({
        vulnerability: 'sast',
        _note: 'something else',
        _x: 'y',
      });
    });
  });

  /**
   * Project-discovery proxies. These two endpoints are the entry points an
   * AI agent uses to convert a human-readable org/project name into the
   * `projectId` required by every other tool. We assert the same three
   * invariants used elsewhere: URL+verb shape, Bearer auth header, upstream
   * error pass-through.
   */
  describe('listOrganizations', () => {
    it('GETs /organizations with Bearer auth and returns the gateway payload', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockResolvedValueOnce({
        data: { organizations: [{ id: 'o-1', name: 'Acme' }] },
      });

      const result = await service.listOrganizations('tok');

      expect(http.get).toHaveBeenCalledTimes(1);
      const [url, cfg] = http.get.mock.calls[0] as [
        string,
        { headers: { Authorization: string }; params?: unknown },
      ];
      expect(url).toBe('/organizations');
      expect(cfg.params).toBeUndefined();
      expect(cfg.headers.Authorization).toBe('Bearer tok');
      expect(result).toEqual({
        organizations: [{ id: 'o-1', name: 'Acme' }],
      });
    });

    it('throws upstream message on failure', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockRejectedValueOnce(
        Object.assign(new Error('x'), {
          response: { data: { message: 'orgs failed' } },
        }),
      );

      await expect(service.listOrganizations('tok')).rejects.toThrow(
        'orgs failed',
      );
    });
  });

  describe('listProjects', () => {
    it('GETs /mcp/organization/<id>/projects with pruned pagination + search params', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockResolvedValueOnce({
        data: { projects: [], totalProjects: 0 },
      });

      // pageSize 10 = the real cap (ProjectGetAllBodyDto @Max(10)); the
      // search_projects tool clamps to it before reaching here. This test only
      // asserts the client-layer pass-through (pruneQuery), which is DTO-unaware.
      const result = await service.listProjects(
        'org-1',
        { search: 'api', page: 1, pageSize: 10, dropMe: undefined },
        'tok',
      );

      expect(http.get).toHaveBeenCalledTimes(1);
      const [url, cfg] = http.get.mock.calls[0] as [
        string,
        {
          headers: { Authorization: string };
          params?: Record<string, unknown>;
        },
      ];
      expect(url).toBe('/mcp/organization/org-1/projects');
      expect(cfg.params).toEqual({ search: 'api', page: 1, pageSize: 10 });
      expect(cfg.headers.Authorization).toBe('Bearer tok');
      expect(result).toEqual({ projects: [], totalProjects: 0 });
    });

    it('url-encodes the organizationId defensively', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockResolvedValueOnce({ data: {} });

      await service.listProjects('org with space', {}, 'tok');

      const [url] = http.get.mock.calls[0] as [string, unknown];
      expect(url).toBe(
        `/mcp/organization/${encodeURIComponent('org with space')}/projects`,
      );
    });

    it('passes params=undefined when query is empty after pruning', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockResolvedValueOnce({ data: {} });

      await service.listProjects('org-1', {}, 'tok');

      const cfg = http.get.mock.calls[0][1] as { params?: unknown };
      expect(cfg.params).toBeUndefined();
    });

    it('throws upstream message on failure', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockRejectedValueOnce(
        Object.assign(new Error('x'), {
          response: { data: { message: 'list projects failed' } },
        }),
      );

      await expect(service.listProjects('org-1', {}, 'tok')).rejects.toThrow(
        'list projects failed',
      );
    });
  });

  describe('team, project creation and repository link routes', () => {
    it('listTeams GETs /organization/<id>/teams with Bearer auth', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockResolvedValueOnce({
        data: { teams: [{ id: 't-1', name: 'Core' }] },
      });

      const result = await service.listTeams('o-1', 'tok');

      const [url, cfg] = http.get.mock.calls[0] as [
        string,
        { headers: { Authorization: string } },
      ];
      expect(url).toBe('/organization/o-1/teams');
      expect(cfg.headers.Authorization).toBe('Bearer tok');
      expect(result).toEqual({ teams: [{ id: 't-1', name: 'Core' }] });
    });

    // The gateway's ProjectCreateBodyDto passes an absent AI flag
    // on, and global-management stores it as false. A project the agent
    // creates must start as one created in the dashboard does
    // (AI_FEATURES_AT_CREATION): every AI feature on, each one turned off in
    // the project settings.
    it('createProject POSTs the name with every AI feature on to /team/<id>/project', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.post.mockResolvedValueOnce({
        data: { projectId: 'p-1', name: 'web' },
      });

      const result = await service.createProject('t-1', 'web', 'tok');

      const [url, body, cfg] = http.post.mock.calls[0] as [
        string,
        unknown,
        { headers: { Authorization: string } },
      ];
      expect(url).toBe('/team/t-1/project');
      expect(body).toEqual({
        name: 'web',
        aiMergeRequestEnabled: true,
        improvingResultsEnabled: true,
        sortsVulnerabilitiesEnabled: true,
        securityChampionEnabled: true,
      });
      expect(cfg.headers.Authorization).toBe('Bearer tok');
      expect(result).toEqual({ projectId: 'p-1', name: 'web' });
    });

    it('createProject keeps the upstream status and message on failure', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.post.mockRejectedValueOnce(
        Object.assign(new Error('Request failed with status code 429'), {
          response: {
            status: 429,
            data: { message: 'Project limit reached for current plan' },
          },
        }),
      );

      const err = (await service
        .createProject('t-1', 'web', 'tok')
        .catch((e: unknown) => e)) as Error & {
        response?: { status?: number };
      };

      expect(err.message).toBe('Project limit reached for current plan');
      expect(err.response?.status).toBe(429);
    });

    it('lists the GitHub and GitLab repositories of an organization', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockResolvedValue({ data: { repositories: [] } });

      await service.listGithubRepositories('o-1', 'tok');
      await service.listGitlabRepositories('o-1', 'tok');

      expect(http.get.mock.calls.map((c) => c[0])).toEqual([
        '/organization/o-1/github/repositories',
        '/integrations/gitlab/organization/o-1/repositories',
      ]);
    });

    it('links a GitHub or GitLab repository with { repositoryId }', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.post.mockResolvedValue({ data: {} });

      await service.linkGithubRepository('o-1', 'p-1', 'r-1', 'tok');
      await service.linkGitlabRepository('o-1', 'p-1', 'r-2', 'tok');

      expect(http.post.mock.calls.map((c) => [c[0], c[1]])).toEqual([
        ['/organization/o-1/project/p-1/github/link', { repositoryId: 'r-1' }],
        [
          '/integrations/gitlab/organization/o-1/project/p-1/link',
          { repositoryId: 'r-2' },
        ],
      ]);
    });

    it('URL-encodes path segments', async () => {
      const { service, http } = buildServiceWithHttpStub();
      http.get.mockResolvedValueOnce({ data: { teams: [] } });

      await service.listTeams('o/1', 'tok');

      expect(http.get.mock.calls[0][0]).toBe('/organization/o%2F1/teams');
    });
  });
});
