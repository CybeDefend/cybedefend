describe('dialect', () => {
  const ORIGINAL = process.env.DB_TYPE;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.DB_TYPE;
    else process.env.DB_TYPE = ORIGINAL;
  });

  it('reads DB_TYPE once, mysql by default', () => {
    jest.isolateModules(() => {
      delete process.env.DB_TYPE;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = require('../dialect');
      expect(m.currentDialect()).toBe('mysql');
      process.env.DB_TYPE = 'postgres';
      expect(m.currentDialect()).toBe('mysql');
    });
    jest.isolateModules(() => {
      process.env.DB_TYPE = 'postgres';
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = require('../dialect');
      expect(m.currentDialect()).toBe('postgres');
    });
    jest.isolateModules(() => {
      process.env.DB_TYPE = '';
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = require('../dialect');
      expect(m.currentDialect()).toBe('mysql');
    });
  });

  it('refuses another engine', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { parseDialect } = require('../dialect');
    expect(() => parseDialect('oracle')).toThrow(
      'DB_TYPE_NOT_SUPPORTED: DB_TYPE must be mysql or postgres',
    );
    expect(parseDialect('mysql')).toBe('mysql');
    expect(parseDialect('postgres')).toBe('postgres');
    expect(parseDialect(undefined)).toBe('mysql');
    expect(parseDialect('')).toBe('mysql');
  });

  it('binds the top-level exports to the current dialect', () => {
    jest.isolateModules(() => {
      process.env.DB_TYPE = 'postgres';
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const index = require('../index');
      expect(index.currentDialect()).toBe('postgres');
      expect(index.sql`SELECT ${1}`.text).toBe('SELECT $1');
      expect(index.sql`SELECT ${1}`.params).toEqual([1]);
    });
    jest.isolateModules(() => {
      delete process.env.DB_TYPE;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const index = require('../index');
      expect(index.sql`SELECT ${1}`.text).toBe('SELECT ?');
    });
  });
});
