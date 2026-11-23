import { Logger } from 'nestjs-pino';

export function createLoggerMock(): Partial<Logger> {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  } as any;
}

export function createMockRepository<T extends object>() {
  return {
    create: jest.fn((e: Partial<T>) => e as T),
    save: jest.fn(async (e: T) => e),
    findOne: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  } as any;
}
