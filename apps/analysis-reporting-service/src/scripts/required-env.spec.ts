import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requiredEnv } from './required-env';

describe('requiredEnv', () => {
  const NAME = 'REQUIRED_ENV_SPEC_VAR';
  afterEach(() => {
    delete process.env[NAME];
  });

  it('returns the value when the variable is set', () => {
    process.env[NAME] = 's3cr3t';
    expect(requiredEnv(NAME)).toBe('s3cr3t');
  });

  it.each([undefined, ''])(
    'throws a message naming the variable when it is %p',
    (value) => {
      if (value !== undefined) process.env[NAME] = value;
      expect(() => requiredEnv(NAME)).toThrow(
        `${NAME} is not set: export it before running this script`,
      );
    },
  );
});

describe('maintenance scripts', () => {
  // A literal fallback for a database credential means a script silently
  // connects with a well-known password when the variable is missing.
  const dir = __dirname;
  const sources = readdirSync(dir).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
  );

  it.each(sources)('%s has no literal database password fallback', (file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    expect(text).not.toMatch(/DB_PASSWORD\s*(\?\?|\|\|)/);
  });
});
