const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True for a string that is a UUID and nothing else, whatever its version (the
 * gateway's own `ParseUUIDPipe` accepts them all).
 *
 * For an id that comes from the URL and is about to be put in a request path:
 * anything else — a word, a path, a UUID with something around it — never
 * reaches a path.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
