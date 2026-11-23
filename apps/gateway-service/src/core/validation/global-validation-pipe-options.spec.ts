import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GLOBAL_VALIDATION_PIPE_OPTIONS } from './global-validation-pipe-options';

describe('GLOBAL_VALIDATION_PIPE_OPTIONS', () => {
  it('is what main.ts mounts', () => {
    expect(GLOBAL_VALIDATION_PIPE_OPTIONS).toEqual({
      transform: true,
      whitelist: true,
      transformOptions: { enableImplicitConversion: true },
    });
  });

  it('is the object main.ts hands to the global ValidationPipe', () => {
    const main = readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf8');

    expect(main).toContain(
      'new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS)',
    );
  });
});

// The « generated analysis-reporting gRPC code » cases are tested with the
// cloud edition: the closed protos are loaded only by the closed
// ANALYSIS_REPORTING_CLOSED_SERVICE client, never by the core.
