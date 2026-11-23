// Generic: byte-identical in every service with an edition layer
// (scripts/tests/service-auth-parity.bats). Change all copies together.
//
// Every gRPC server of this service checks its callers, every gRPC client
// signs its calls, and the key comes through SecretsService.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import SecretsService from '../secrets/secrets.service';
import {
  registerServiceAuthKeySource,
  resolveServiceAuthSigningKey,
} from './service-auth.edition';

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      // The generated gRPC code sits in subfolders of core/grpc.
      if (relative(SRC, dir) === join('core', 'grpc')) return [];
      return sourceFiles(path);
    }
    return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
  });
}

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

describe('service-auth wiring', () => {
  const files = sourceFiles(SRC).map((path) => ({
    path: relative(SRC, path),
    text: readFileSync(path, 'utf8'),
  }));

  it('installs the check on every gRPC server it starts', () => {
    for (const { path, text } of files) {
      const servers = count(text, /(?:create|connect)Microservice</g);
      if (servers === 0) continue;
      expect({
        path,
        checked: count(
          text,
          /channelOptions: serviceAuthServerChannelOptions\(\)/g,
        ),
      }).toEqual({ path, checked: servers });
    }
  });

  it('signs the calls of every gRPC client it builds', () => {
    const builders = files.filter(({ text }) =>
      /channelOptions: \{/.test(text),
    );
    for (const { path, text } of builders) {
      expect({
        path,
        signed: count(text, /\.\.\.serviceAuthClientChannelOptions\(\)/g),
      }).toEqual({ path, signed: count(text, /channelOptions: \{/g) });
    }
  });

  it('reads the key through SecretsService', () => {
    const saved = process.env.CYBEDEFEND_EDITION;
    process.env.CYBEDEFEND_EDITION = 'cloud';
    try {
      new SecretsService({
        getSecret: (name: string) =>
          name === 'SERVICE_AUTH_KEY' ? 's'.repeat(64) : undefined,
        ensureCacheLoaded: async () => undefined,
        handleRotationEvent: async () => undefined,
      });
      expect(resolveServiceAuthSigningKey()).toBe('s'.repeat(64));
    } finally {
      registerServiceAuthKeySource(null);
      if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
      else process.env.CYBEDEFEND_EDITION = saved;
    }
  });
});
