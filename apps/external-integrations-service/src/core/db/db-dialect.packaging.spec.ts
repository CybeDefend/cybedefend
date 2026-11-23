describe('@cybedefend/db-dialect packaging', () => {
  it('resolves @cybedefend/db-dialect', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const d = require('@cybedefend/db-dialect');
    expect(d.dialectApi('postgres').sql`SELECT ${1}`.text).toBe('SELECT $1');
  });

  it('has the pg driver TypeORM loads for postgres', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(() => require('pg')).not.toThrow();
  });
});
