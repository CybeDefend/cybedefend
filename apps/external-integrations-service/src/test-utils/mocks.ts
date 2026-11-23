import { Logger } from 'nestjs-pino';
import { Repository } from 'typeorm';

export const createLoggerMock = () =>
  ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }) as unknown as Logger;

export const createMockRepository = <T = any>() =>
  ({
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(),
  }) as unknown as jest.Mocked<Repository<T>>;
