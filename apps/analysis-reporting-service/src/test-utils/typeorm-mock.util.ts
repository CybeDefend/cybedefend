// Lightweight TypeORM repository mock helpers for unit tests
// Mirrors the pattern used in other services to keep tests concise.

export type MockType<T> = {
  [P in keyof T]?: jest.Mock<any, any>;
};

export function createMockRepository<T extends object>(
  overrides: Partial<MockType<T>> = {},
): MockType<T> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((e) => e),
    createQueryBuilder: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    ...overrides,
  } as unknown as MockType<T>;
}

export function createLoggerMock() {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  } as any;
}

/**
 * A query builder whose every step returns itself and whose `execute`
 * resolves, for specs that go through a grouped write without looking at the
 * statement (the SCA ingestion's multi-row INSERTs, UPDATE and
 * DELETE by ids).
 */
export function createQueryBuilderMock(
  result: unknown = { identifiers: [], generatedMaps: [], affected: 0 },
): Record<string, jest.Mock> {
  const builder: Record<string, jest.Mock> = {};
  for (const step of [
    'insert',
    'into',
    'values',
    'orUpdate',
    'updateEntity',
    'update',
    'set',
    'where',
    'whereInIds',
    'delete',
    'from',
  ]) {
    builder[step] = jest.fn(() => builder);
  }
  builder.execute = jest.fn().mockResolvedValue(result);
  return builder;
}
