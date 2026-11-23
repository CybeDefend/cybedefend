import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DERIVED_SECRET_KEYS } from '../../core/secrets/secret-key';
import { CommunitySecretsSource } from './secrets.community';

interface Vectors {
  masterKeys: Array<{
    hex?: string;
    base64?: string;
    derived: Record<string, string>;
  }>;
}

const vectors: Vectors = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../../../libs/test-fixtures/secrets/hkdf-vectors.json',
    ),
    'utf8',
  ),
);

const FIRST = vectors.masterKeys[0];

describe('CommunitySecretsSource', () => {
  const savedEnv = process.env;
  let source: CommunitySecretsSource;

  beforeEach(() => {
    process.env = { ...savedEnv };
    delete process.env.CYBEDEFEND_SECRET_KEY;
    delete process.env.CYBEDEFEND_SECRET_KEY_FILE;
    process.env.CYBEDEFEND_SECRET_KEY = FIRST.hex as string;
    source = new CommunitySecretsSource();
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it('derives every derived service key when it is not set', () => {
    for (const [name, value] of Object.entries(FIRST.derived)) {
      expect(source.getSecret(name)).toBe(value);
    }
  });

  it('every derived key decodes the way its consumer decodes it', () => {
    for (const [name, spec] of Object.entries(DERIVED_SECRET_KEYS)) {
      const value = source.getSecret(name) as string;
      if (spec.encoding === 'hex') {
        expect(value).toMatch(/^[0-9a-f]{64}$/);
      } else {
        expect(Buffer.from(value, 'base64').length).toBe(32);
      }
    }
  });

  it('an explicitly set key wins over its derivation', () => {
    process.env.GITLAB_ENCRYPTION_KEY = 'cd'.repeat(32);
    expect(source.getSecret('GITLAB_ENCRYPTION_KEY')).toBe('cd'.repeat(32));
  });

  it('an empty variable counts as unset', () => {
    process.env.GITLAB_ENCRYPTION_KEY = '';
    expect(source.getSecret('GITLAB_ENCRYPTION_KEY')).toBe(
      FIRST.derived.GITLAB_ENCRYPTION_KEY,
    );
  });

  it('reads <KEY>_FILE when <KEY> is unset, without its trailing newline, once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-secrets-'));
    const file = path.join(dir, 'permify-schema-version');
    fs.writeFileSync(file, 'v1\n');
    process.env.PERMIFY_SCHEMA_VERSION_FILE = file;
    expect(source.getSecret('PERMIFY_SCHEMA_VERSION')).toBe('v1');
    fs.writeFileSync(file, 'v2');
    expect(source.getSecret('PERMIFY_SCHEMA_VERSION')).toBe('v1');
  });

  it('accepts CYBEDEFEND_SECRET_KEY_FILE', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-secrets-'));
    const file = path.join(dir, 'master-key');
    fs.writeFileSync(file, (FIRST.base64 as string) + '\n');
    delete process.env.CYBEDEFEND_SECRET_KEY;
    process.env.CYBEDEFEND_SECRET_KEY_FILE = file;
    const fresh = new CommunitySecretsSource();
    expect(fresh.getSecret('GITLAB_ENCRYPTION_KEY')).toBe(
      FIRST.derived.GITLAB_ENCRYPTION_KEY,
    );
  });

  it('names an unreadable _FILE without reading out its content', () => {
    process.env.DB_PASSWORD_FILE = '/nonexistent/x';
    expect(() => source.getSecret('DB_PASSWORD')).toThrow(
      'DB_PASSWORD_FILE points to a file that cannot be read: /nonexistent/x',
    );
  });

  it('starts without CYBEDEFEND_SECRET_KEY: the packaging hands each container only the derived keys it reads, as files', async () => {
    delete process.env.CYBEDEFEND_SECRET_KEY;
    await expect(source.onModuleInit()).resolves.toBeUndefined();
  });

  it('serves a derived key from <KEY>_FILE without the master key', () => {
    delete process.env.CYBEDEFEND_SECRET_KEY;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-secrets-'));
    const file = path.join(dir, 'GITLAB_ENCRYPTION_KEY');
    fs.writeFileSync(file, `${FIRST.derived.GITLAB_ENCRYPTION_KEY}\n`, {
      mode: 0o400,
    });
    process.env.GITLAB_ENCRYPTION_KEY_FILE = file;
    expect(source.getSecret('GITLAB_ENCRYPTION_KEY')).toBe(
      FIRST.derived.GITLAB_ENCRYPTION_KEY,
    );
  });

  it('names a derived key given neither as a file nor through the master key, and both ways to give it', () => {
    delete process.env.CYBEDEFEND_SECRET_KEY;
    delete process.env.GITLAB_ENCRYPTION_KEY_FILE;
    expect(() => source.getSecret('GITLAB_ENCRYPTION_KEY')).toThrow(
      'GITLAB_ENCRYPTION_KEY is not set: set GITLAB_ENCRYPTION_KEY_FILE, or CYBEDEFEND_SECRET_KEY to derive it.',
    );
  });

  it('refuses to start with a short key', async () => {
    process.env.CYBEDEFEND_SECRET_KEY = 'ab'.repeat(16);
    await expect(source.onModuleInit()).rejects.toThrow('it decodes to 16');
  });

  it('answers undefined for a key it does not know', () => {
    expect(source.getSecret('NOT_A_KEY')).toBeUndefined();
  });

  it('ensureCacheLoaded and handleRotationEvent resolve and change nothing', async () => {
    await source.ensureCacheLoaded();
    await source.handleRotationEvent();
    expect(source.getSecret('GITLAB_ENCRYPTION_KEY')).toBe(
      FIRST.derived.GITLAB_ENCRYPTION_KEY,
    );
  });
});
