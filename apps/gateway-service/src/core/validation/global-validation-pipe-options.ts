import type { ValidationPipeOptions } from '@nestjs/common';

/**
 * The options of the gateway's global `ValidationPipe` (mounted in `main.ts`).
 *
 * `whitelist` strips an unknown key, it never refuses it (there is no
 * `forbidNonWhitelisted`), and `enableImplicitConversion` coerces `"4"` for a
 * number field. A test of a body or query DTO builds its pipe from this
 * constant, so it validates what a real request meets.
 */
export const GLOBAL_VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  transform: true,
  whitelist: true,
  transformOptions: { enableImplicitConversion: true },
};
