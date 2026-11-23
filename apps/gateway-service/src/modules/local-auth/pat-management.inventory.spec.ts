import { HttpException, HttpStatus } from '@nestjs/common';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { UserController } from 'src/modules/user/user.controller';
import { PersonalAccessTokensController } from './personal-access-tokens.controller';

/**
 * Every gateway handler that reaches a personal-access-token gRPC call
 * (create, delete, revoke, rename, list) refuses a caller authenticated by a
 * personal access token in the Community edition: 403
 * PAT_FORBIDDEN_FOR_PAT_MANAGEMENT, no call. In Community global-management's
 * UserService routes the legacy `/user/personal-access-tokens` calls to the
 * same token store as `/me/personal-access-tokens`, so a leaked `cdp_` token
 * must not mint a permanent one through either surface.
 *
 * The inventory is read from the source: a gRPC client call in a service
 * file names the service method that wraps it, and every controller method
 * calling that wrapper is a handler. A new one fails the pinned list until
 * it is added here, with its refusal proven below. The cloud cases (a PAT
 * caller still served on `/user/personal-access-tokens`) are tested with the
 * cloud edition.
 */
const PAT_GRPC_METHODS = [
  'createPersonalAccessToken',
  'deletePersonalAccessToken',
  'revokePersonalAccessToken',
  'updatePersonalAccessTokenName',
  'listPersonalAccessTokens',
];

const SRC = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (full === join(SRC, 'core', 'grpc')) continue;
      walk(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** The method declared around `index` in a class body (nearest above). */
function enclosingMethod(text: string, index: number): string | undefined {
  const before = text.slice(0, index);
  const re =
    /^\s{2}(?:async\s+)?(?:private\s+|public\s+)?([A-Za-z0-9_]+)\s*\(/gm;
  let name: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before)) !== null) {
    if (!['if', 'for', 'while', 'switch', 'return'].includes(m[1])) {
      name = m[1];
    }
  }
  return name;
}

function inventory(): string[] {
  const files = walk(SRC);
  // 1. Service methods wrapping a gRPC client call on a PAT method.
  const wrappers = new Set<string>();
  const clientCall = new RegExp(
    `(?:Client|client|\\(\\))\\s*\\.\\s*(${PAT_GRPC_METHODS.join('|')})\\s*\\(`,
    'g',
  );
  for (const file of files.filter((f) => f.endsWith('.service.ts'))) {
    const text = readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = clientCall.exec(text)) !== null) {
      const wrapper = enclosingMethod(text, m.index);
      if (wrapper) wrappers.add(wrapper);
    }
  }
  // 2. Controller handlers calling one of those wrappers.
  const handlers = new Set<string>();
  const wrapperCall = new RegExp(`\\.(${[...wrappers].join('|')})\\s*\\(`, 'g');
  for (const file of files.filter((f) => f.endsWith('.controller.ts'))) {
    const text = readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = wrapperCall.exec(text)) !== null) {
      const handler = enclosingMethod(text, m.index);
      if (handler) handlers.add(`${relative(SRC, file)}#${handler}`);
    }
  }
  return [...handlers].sort();
}

const PINNED = [
  'modules/local-auth/personal-access-tokens.controller.ts#create',
  'modules/local-auth/personal-access-tokens.controller.ts#list',
  'modules/local-auth/personal-access-tokens.controller.ts#revoke',
  'modules/user/user.controller.ts#createPersonalAccessToken',
  'modules/user/user.controller.ts#deletePersonalAccessToken',
  'modules/user/user.controller.ts#listPersonalAccessTokens',
  'modules/user/user.controller.ts#updatePersonalAccessTokenName',
];

const patReq = { user: { sub: 'user-1', via: 'pat' } };
const jwtReq = { user: { sub: 'user-1', via: 'jwt' } };
const reply = { header: jest.fn() };

function userController() {
  const service = {
    listPersonalAccessTokens: jest.fn().mockResolvedValue({ tokens: [] }),
    createPersonalAccessToken: jest.fn().mockResolvedValue({}),
    deletePersonalAccessToken: jest.fn().mockResolvedValue({}),
    updatePersonalAccessTokenName: jest.fn().mockResolvedValue({}),
  };
  const controller = new UserController(service as never, {} as never);
  return { controller, service };
}

function meController() {
  const service = {
    listPersonalAccessTokens: jest.fn().mockResolvedValue([]),
    createPersonalAccessToken: jest.fn().mockResolvedValue({
      token: {
        id: 't-1',
        name: 'x',
        lastFour: 'abcd',
        createdAt: '1',
        lastUsedAt: '0',
        expiresAt: '0',
      },
      value: 'cdp_secret',
    }),
    revokePersonalAccessToken: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new PersonalAccessTokensController(service as never);
  return { controller, service };
}

type Invoke = (req: object) => {
  run: () => unknown;
  calls: () => number;
};

const HANDLERS: Record<string, Invoke> = {
  'modules/user/user.controller.ts#listPersonalAccessTokens': (req) => {
    const { controller, service } = userController();
    return {
      run: () => controller.listPersonalAccessTokens(req),
      calls: () => service.listPersonalAccessTokens.mock.calls.length,
    };
  },
  'modules/user/user.controller.ts#createPersonalAccessToken': (req) => {
    const { controller, service } = userController();
    return {
      run: () => controller.createPersonalAccessToken(req, { name: 'x' }),
      calls: () => service.createPersonalAccessToken.mock.calls.length,
    };
  },
  'modules/user/user.controller.ts#deletePersonalAccessToken': (req) => {
    const { controller, service } = userController();
    return {
      run: () => controller.deletePersonalAccessToken(req, { name: 'x' }),
      calls: () => service.deletePersonalAccessToken.mock.calls.length,
    };
  },
  'modules/user/user.controller.ts#updatePersonalAccessTokenName': (req) => {
    const { controller, service } = userController();
    return {
      run: () =>
        controller.updatePersonalAccessTokenName(req, {
          currentName: 'x',
          newName: 'y',
        }),
      calls: () => service.updatePersonalAccessTokenName.mock.calls.length,
    };
  },
  'modules/local-auth/personal-access-tokens.controller.ts#list': (req) => {
    const { controller, service } = meController();
    return {
      run: () => controller.list(req as never, reply as never),
      calls: () => service.listPersonalAccessTokens.mock.calls.length,
    };
  },
  'modules/local-auth/personal-access-tokens.controller.ts#create': (req) => {
    const { controller, service } = meController();
    return {
      run: () =>
        controller.create({ name: 'x' } as never, req as never, reply as never),
      calls: () => service.createPersonalAccessToken.mock.calls.length,
    };
  },
  'modules/local-auth/personal-access-tokens.controller.ts#revoke': (req) => {
    const { controller, service } = meController();
    return {
      run: () =>
        controller.revoke(
          '00000000-0000-4000-8000-000000000000',
          req as never,
          reply as never,
        ),
      calls: () => service.revokePersonalAccessToken.mock.calls.length,
    };
  },
};

async function outcome(run: () => unknown): Promise<unknown> {
  try {
    await run();
    return 'ok';
  } catch (err) {
    return err;
  }
}

describe('personal-access-token management inventory (Community)', () => {
  const saved = process.env.CYBEDEFEND_EDITION;
  afterEach(() => {
    if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = saved;
  });

  it('lists every handler reaching a personal-access-token gRPC call', () => {
    expect(inventory()).toEqual(PINNED);
    expect(Object.keys(HANDLERS).sort()).toEqual(PINNED);
  });

  it.each(PINNED)(
    '%s refuses a PAT caller in Community, without a call',
    async (handler) => {
      process.env.CYBEDEFEND_EDITION = 'community';
      const h = HANDLERS[handler](patReq);
      const err = await outcome(h.run);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
      expect((err as HttpException).getResponse()).toEqual({
        message: 'PAT_FORBIDDEN_FOR_PAT_MANAGEMENT',
        code: 'PAT_FORBIDDEN_FOR_PAT_MANAGEMENT',
      });
      expect(h.calls()).toBe(0);
    },
  );

  it.each(PINNED)(
    '%s serves a session (JWT) caller in Community',
    async (handler) => {
      process.env.CYBEDEFEND_EDITION = 'community';
      const h = HANDLERS[handler](jwtReq);
      expect(await outcome(h.run)).toBe('ok');
      expect(h.calls()).toBe(1);
    },
  );
});
