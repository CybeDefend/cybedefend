import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/**
 * Validates an opaque identifier passed as a path parameter that is then
 * interpolated into an upstream URL path. Only safe characters are accepted:
 * 1 to 64 of `[A-Za-z0-9_-]`. That refuses `/`, `\`, `.` (so no `.` or `..`
 * segment) and `%` (so no encoded separator, single or double), which keeps
 * the id a single path segment. Fastify decodes `%2F` inside a route param, so
 * the check runs on the decoded value.
 *
 * Not `ParseUUIDPipe`: these ids are slugs or 32-hex-character ids as well as
 * UUIDs, and the upstream id columns hold at most 64 characters.
 */
@Injectable()
export class ParseOpaqueIdPipe implements PipeTransform<string, string> {
  private static readonly PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

  transform(value: string): string {
    if (typeof value !== 'string' || !ParseOpaqueIdPipe.PATTERN.test(value)) {
      throw new BadRequestException(
        'Invalid identifier: must be 1-64 chars of [A-Za-z0-9_-].',
      );
    }
    return value;
  }
}
