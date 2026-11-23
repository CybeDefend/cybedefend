jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('migration DataSource', () => {
  const saved = process.env.POLICY_DB_PASSWORD;
  afterEach(() => {
    if (saved === undefined) delete process.env.POLICY_DB_PASSWORD;
    else process.env.POLICY_DB_PASSWORD = saved;
  });

  const load = () =>
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./data-source');
    });

  it.each([undefined, ''])(
    'refuses to build without POLICY_DB_PASSWORD (%p) instead of using a default password',
    (value) => {
      if (value === undefined) delete process.env.POLICY_DB_PASSWORD;
      else process.env.POLICY_DB_PASSWORD = value;
      expect(load).toThrow('POLICY_DB_PASSWORD is not set');
    },
  );

  it('uses POLICY_DB_PASSWORD when it is set', () => {
    process.env.POLICY_DB_PASSWORD = 'from-env';
    let options: { password?: unknown } = {};
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      options = require('./data-source').AppDataSource.options;
    });
    expect(options.password).toBe('from-env');
  });
});
