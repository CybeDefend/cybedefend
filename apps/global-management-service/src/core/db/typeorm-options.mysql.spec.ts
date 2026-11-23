import { resolveDbConnection } from './typeorm-options';

const DB = {
  DB_HOST: 'db.internal',
  DB_PORT: '3306',
  DB_USERNAME: 'gm',
  DB_PASSWORD: 'pw',
  DB_DATABASE: 'global_management',
};

function secrets(over: Record<string, string | undefined> = {}) {
  const all: Record<string, string | undefined> = { ...DB, ...over };
  return {
    ensureCacheLoaded: jest.fn().mockResolvedValue(undefined),
    getSecret: jest.fn((key: string) => all[key]),
  } as any;
}
const config = (values: Record<string, string> = {}) =>
  ({ get: jest.fn((key: string) => values[key]) }) as any;

// The MySQL cases (the cloud track; the Community Edition refuses mysql) live
// in the closed edition.
describe('buildTypeOrmOptions on mysql', () => {
  it('refuses to start without a connection secret, or with a port that is not a number', async () => {
    await expect(
      resolveDbConnection(secrets({ DB_PASSWORD: undefined }), config()),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      resolveDbConnection(secrets({ DB_PORT: 'mysql' }), config()),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
