// What every reader of usage.mjs needs to read a harness's session log: a
// log read a line at a time, a time with its zone, a count of tokens.

import { closeSync, openSync, readSync, statSync } from 'node:fs';

/** A session log larger than this is not read. */
const MAX_LOG_BYTES = 128 * 1024 * 1024;
/** A line longer than this (a huge tool result) is skipped: no answer's usage is that long. */
const MAX_LINE_BYTES = 4 * 1024 * 1024;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** The four kinds of token a reader gives for each call. */
export const FIELDS = ['input', 'cacheWrite', 'cacheRead', 'output'];

/** A count of tokens as the log gives it: a positive whole number, or 0. */
export const count = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
/** A time with its zone, as a number; null for anything else (a bare date would widen the window). */
export const time = (t) => {
  const ms = t instanceof Date ? t.getTime() : ISO.test(String(t ?? '')) ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Calls `fn` with each line of a file, read a megabyte at a time: a long
 * session log never sits whole in memory. False when the file cannot be read
 * or is larger than MAX_LOG_BYTES.
 */
export function eachLine(file, fn, { maxBytes = MAX_LOG_BYTES, maxLine = MAX_LINE_BYTES } = {}) {
  let fd;
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size > maxBytes) return false;
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(1024 * 1024);
    let rest = Buffer.alloc(0);
    let skipping = false;
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0; ) {
      const chunk = rest.length ? Buffer.concat([rest, buf.subarray(0, n)]) : buf.subarray(0, n);
      let start = 0;
      for (let i; (i = chunk.indexOf(10, start)) !== -1; start = i + 1) {
        if (!skipping) fn(chunk.toString('utf8', start, i));
        skipping = false;
      }
      rest = Buffer.from(chunk.subarray(start));
      // A line too long to be an answer: dropped up to its end.
      if (rest.length > maxLine) {
        rest = Buffer.alloc(0);
        skipping = true;
      }
    }
    if (rest.length && !skipping) fn(rest.toString('utf8'));
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
