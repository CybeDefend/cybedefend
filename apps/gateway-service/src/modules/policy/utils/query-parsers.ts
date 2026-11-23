import { BadRequestException } from '@nestjs/common';

/**
 * Reads an optional boolean query parameter from its RAW value.
 *
 * The route must declare the parameter as `string`: the gateway's global
 * ValidationPipe (main.ts, `transform: true`) runs before any parameter pipe
 * and rewrites a `boolean` parameter itself, every value but 'true' becoming
 * false, so `?isEnabled=yes` was read as « disabled » and a ParseBoolPipe
 * after it only ever saw a boolean. A `string` parameter reaches this
 * function untouched.
 *
 * Absent → undefined (no filter); 'true' / 'false' → the boolean; anything
 * else → 400.
 */
export function parseOptionalBooleanQuery(
  name: string,
  raw: string | undefined,
): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new BadRequestException(`${name} must be true or false`);
}
