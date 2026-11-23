import multipart from '@fastify/multipart';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  IMPORT_MULTIPART_LIMITS,
  registerMultipart,
} from './register-multipart';

describe('registerMultipart', () => {
  it('pins the import limits of the contract', () => {
    expect(IMPORT_MULTIPART_LIMITS).toEqual({
      fileSize: 52_428_800,
      files: 2,
      fields: 5,
      fieldSize: 1024,
      parts: 7,
    });
  });

  it('registers multipart with the import limits', async () => {
    const register = jest.fn().mockResolvedValue(undefined);
    await registerMultipart({ register } as unknown as NestFastifyApplication);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(multipart, {
      limits: IMPORT_MULTIPART_LIMITS,
    });
  });

  it('main.ts registers it right after the compression plugin', () => {
    const main = readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf8');
    expect(main).toContain('await registerMultipart(app)');
    expect(main.indexOf('await registerMultipart(app)')).toBeGreaterThan(
      main.indexOf('await registerCompression(app)'),
    );
  });
});
