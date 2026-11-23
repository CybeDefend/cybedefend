import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/**
 * Validates a tool-call id passed as a path parameter on the global-chat
 * HITL routes (``confirm`` / ``reject``).
 *
 * The agent stores the LLM-emitted ``tool_call.id`` verbatim
 * so that the subsequent ``tool_result`` block can be cross-referenced.
 * Devstral and other OpenAI-style providers emit short alphanumeric ids
 * (e.g. ``9iLfg92Zw``, ``call_abc123…``) which are NOT UUIDs.
 * ``ParseUUIDPipe`` therefore rejected every legitimate confirm/reject
 * with a 400, completely breaking the dashboard HITL flow.
 *
 * This pipe restricts the format to ``[A-Za-z0-9_-]{1,64}`` — strict
 * enough to refuse path-traversal (no slashes / dots / spaces), wide
 * enough to accept every id shape the orchestrator currently produces
 * (LLM-native ids and the ``tc-<uuid4hex>`` fallback) without
 * regressing legitimate UUID callers.
 */
@Injectable()
export class ParseToolCallIdPipe implements PipeTransform<string, string> {
  // ASCII alphanumeric plus the two punctuation characters every
  // observed id format uses (hyphen for UUIDs / ``tc-<hex>``,
  // underscore for OpenAI ``call_<id>``). Bounded length keeps the
  // route segment well within URL length and rules out denial-of-
  // service via gigantic ids.
  private static readonly PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

  transform(value: string): string {
    if (typeof value !== 'string' || !ParseToolCallIdPipe.PATTERN.test(value)) {
      throw new BadRequestException(
        'Invalid tool-call id: must be 1-64 chars of [A-Za-z0-9_-].',
      );
    }
    return value;
  }
}
