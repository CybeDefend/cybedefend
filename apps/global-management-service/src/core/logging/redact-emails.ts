/**
 * Strip anything that looks like an address out of a string bound for the logs.
 *
 * Deliberately greedy on both sides of the `@` and stopping at whitespace and
 * the angle brackets / parentheses an SMTP reply wraps a recipient in. Use it
 * on any error message that may have travelled through a row, a mail transport
 * or a driver: `ER_DUP_ENTRY: Duplicate entry 'jane@acme.io' for key 'email'`
 * is a database error, not a log line we are allowed to keep.
 */
export function redactEmails(message: string): string {
  return message.replace(/[^\s<>()]+@[^\s<>()]+/g, '<redacted>');
}
