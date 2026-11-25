import type { Logger, LoggerOptions } from 'pino';

/**
 * How an error is written to the logs, the same in every service.
 *
 * A database error carries the statement it ran, its bound parameters and the
 * driver's own detail: e-mail addresses, names, password hashes, token
 * digests, whole user-supplied texts. TypeORM's QueryFailedError keeps
 * `query`, `parameters` and `driverError`, and copies every field of the
 * driver error onto itself (mysql2's `sql` with the values inlined and
 * `sqlMessage`; pg's `detail`, `where`, `internalQuery`). The engines'
 * messages also quote the offending value: MySQL's
 * `Duplicate entry '<value>' for key '<key>'`, PostgreSQL's
 * `invalid input syntax for type uuid: "<value>"`.
 *
 * - `serializeLoggedError` keeps what an operator needs (the class, the
 *   message with the engines' quoted values replaced, the error code, the SQL
 *   state, constraint, table and column names, the statement's verb and the
 *   tables it touches, the stack frames, the cause and the inner errors of an
 *   aggregate, summarized the same way) and nothing else: an allow-list, so a
 *   field a driver adds later is dropped too. Any other value passes through,
 *   with the errors it holds summarized.
 * - `LOGGED_ERROR_LOGGER_OPTIONS` applies it to every value of a logged
 *   object, under any key, and keeps the raw message of an error out of the
 *   line's `msg`, which pino otherwise copies from `err.message` before any
 *   serializer runs.
 * - `createHttpLoggerOptions` gives pino-http the same serializers and binds
 *   only an allow-list of request fields to every line of a request.
 */

/** Written in place of a value an engine's message quotes. */
export const REDACTED_VALUE = '[redacted]';

/** Identifier-like fields a driver sets: codes and schema names, never a value. */
const IDENTIFIER_FIELDS = [
  'code',
  'errno',
  'sqlState',
  'constraint',
  'table',
  'column',
  'schema',
  'routine',
] as const;

/** Numeric status fields (an HTTP status, a gRPC code). */
const NUMERIC_FIELDS = ['status', 'statusCode'] as const;

/** Where TypeORM and other wrappers keep the driver's own error. */
const NESTED_DRIVER_FIELDS = ['driverError', 'originalError'] as const;

/** The fields of a driver error that hold a statement or a value. */
const DRIVER_VALUE_FIELDS = [
  'query',
  'parameters',
  'sql',
  'sqlMessage',
  'detail',
  'where',
  'internalQuery',
  'hint',
  'driverError',
] as const;

/** A message is cut to this length before anything else reads it. */
const MAX_SCRUB_INPUT = 2048;
const MAX_MESSAGE_LENGTH = 512;
const MAX_IDENTIFIER_LENGTH = 64;
const MAX_STACK_FRAMES = 30;
const MAX_CAUSE_DEPTH = 3;
const MAX_INNER_ERRORS = 10;
/** How deep, and how many values, a logged object is searched for errors. */
const MAX_WALK_DEPTH = 4;
const MAX_WALK_NODES = 500;
const MAX_WALK_ARRAY = 50;
/** The part of a statement read for its verb and tables. */
const MAX_STATEMENT_SCAN = 4096;
const MAX_STATEMENT_TABLES = 5;

type Fields = Record<string, unknown>;

function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null;
}

function read(source: Fields, key: string): unknown {
  try {
    return source[key];
  } catch {
    return undefined;
  }
}

/** Letters, digits, `_`, `.` and `-` only, cut to 64 characters. */
function identifier(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value)
    .replace(/[^\w.-]/g, '_')
    .slice(0, MAX_IDENTIFIER_LENGTH);
  return text.length > 0 ? text : undefined;
}

// ---------------------------------------------------------------------------
// The engines' messages that quote a value
// ---------------------------------------------------------------------------

/**
 * A message shape of MySQL or PostgreSQL that quotes a value: where the value
 * starts (just after `prefix`) and where it ends (the last `suffix` after
 * it, else the last `close` character, else the end of the message). The end
 * is searched from the end of the message, so a value that holds the suffix
 * itself leaves nothing behind.
 */
interface ValueShape {
  prefix: RegExp;
  suffixes?: string[];
  close?: string;
  /** The shape applies only when one of its suffixes follows the prefix. */
  suffixRequired?: boolean;
}

const VALUE_SHAPES: ValueShape[] = [
  // MySQL: Duplicate entry '<value>' for key '<key>'
  { prefix: /Duplicate entry '/, suffixes: ["' for key '"], close: "'" },
  // MySQL: Incorrect <type> value: '<value>' for column '<column>' at row 1,
  // Truncated incorrect <type> value: '<value>'
  {
    prefix: /[Ii]ncorrect [\w ]{1,40} value: '/,
    suffixes: ["' for column '", "' for function "],
    close: "'",
  },
  // MySQL: … the right syntax to use near '<text>' at line 1
  { prefix: /syntax to use near '/, suffixes: ["' at line "], close: "'" },
  // PostgreSQL: invalid input syntax for type <type>: "<value>"
  { prefix: /invalid input syntax for type [\w ]{1,40}: "/, close: '"' },
  // PostgreSQL: invalid input value for enum <type>: "<value>"
  { prefix: /invalid input value for enum [\w."]{1,64}: "/, close: '"' },
  // PostgreSQL: date/time field value out of range: "<value>"
  { prefix: /field value out of range: "/, close: '"' },
  // PostgreSQL: value "<value>" is out of range for type <type>
  {
    prefix: /\bvalue "/,
    suffixes: ['" is out of range for type '],
    suffixRequired: true,
  },
  // PostgreSQL: invalid value "<value>" for "<pattern>" (to_date, to_number)
  {
    prefix: /\binvalid value "/,
    suffixes: ['" for "'],
    suffixRequired: true,
  },
  // PostgreSQL: syntax error / unterminated quoted string at or near "<text>"
  { prefix: / at or near "/, close: '"' },
  // PostgreSQL: invalid hexadecimal digit: "<character>"
  { prefix: /invalid hexadecimal digit: "/, close: '"' },
  // PostgreSQL: invalid byte sequence for encoding "UTF8": 0x00
  { prefix: /invalid byte sequence for encoding "[\w-]{1,32}": / },
  // PostgreSQL detail: Key (<columns>)=(<values>) already exists.
  {
    prefix: /Key \([^)]{0,256}\)=\(/,
    suffixes: [
      ') already exists',
      ') is not present',
      ') is still referenced',
      ') conflicts with',
    ],
    close: ')',
  },
  // PostgreSQL detail: Failing row contains (<values>).
  { prefix: /Failing row contains \(/, close: ')' },
  // TypeORM: Could not find any entity of type "X" matching: <criteria>
  { prefix: /of type "[\w$]{1,64}" matching: / },
];

/**
 * The text with the value part of every engine message shape replaced by
 * `[redacted]`. Any other text is left alone. Every search is a single scan,
 * so the cost grows linearly with the text.
 */
export function redactEngineValues(text: string): string {
  let out = text;
  for (const shape of VALUE_SHAPES) {
    const match = shape.prefix.exec(out);
    if (!match) continue;
    const start = match.index + match[0].length;
    let end = -1;
    for (const suffix of shape.suffixes ?? []) {
      const at = out.lastIndexOf(suffix);
      if (at >= start && at > end) end = at;
    }
    if (end < 0 && shape.suffixRequired) continue;
    if (end < 0 && shape.close !== undefined) {
      const at = out.lastIndexOf(shape.close);
      if (at >= start) end = at;
    }
    if (end < 0) end = out.length;
    out = `${out.slice(0, start)}${REDACTED_VALUE}${out.slice(end)}`;
  }
  return out;
}

/**
 * The message of a logged error: cut to 2 kB before anything reads it, the
 * engines' quoted values replaced, control characters replaced, cut to 512
 * characters. A message that is not an engine's keeps its words.
 */
export function scrubErrorMessage(message: string): string {
  const cut =
    message.length > MAX_SCRUB_INPUT
      ? message.slice(0, MAX_SCRUB_INPUT)
      : message;
  // Control characters (a NUL byte among them) are replaced, not logged.

  const out = redactEngineValues(cut).replace(
    /[\u0000-\u0008\u000b-\u001f\u007f]/g,
    '?',
  );
  return out.length > MAX_MESSAGE_LENGTH
    ? `${out.slice(0, MAX_MESSAGE_LENGTH)}…`
    : out;
}

// ---------------------------------------------------------------------------
// The statement's shape: its verb and its tables, never its text
// ---------------------------------------------------------------------------

const STATEMENT_VERBS = new Set([
  'ALTER',
  'BEGIN',
  'CALL',
  'COMMIT',
  'COPY',
  'CREATE',
  'DELETE',
  'DO',
  'DROP',
  'EXPLAIN',
  'INSERT',
  'LOCK',
  'MERGE',
  'RELEASE',
  'REPLACE',
  'ROLLBACK',
  'SAVEPOINT',
  'SELECT',
  'SET',
  'SHOW',
  'START',
  'TRUNCATE',
  'UPDATE',
  'WITH',
]);

/**
 * The statement with every literal replaced by `?`: single-quoted strings
 * (with `''` and backslash escapes), dollar-quoted bodies, and double-quoted
 * text that is not a plain identifier (a string literal on MySQL).
 */
export function maskStatementLiterals(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === '\\') {
          i += 2;
        } else if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
        } else if (sql[i] === "'") {
          i += 1;
          break;
        } else {
          i += 1;
        }
      }
      out += '?';
    } else if (ch === '"') {
      const close = sql.indexOf('"', i + 1);
      const inner = close < 0 ? sql.slice(i + 1) : sql.slice(i + 1, close);
      out += /^[\w$]{1,64}$/.test(inner) ? `"${inner}"` : '?';
      i = close < 0 ? sql.length : close + 1;
    } else if (ch === '$' && sql[i + 1] === '$') {
      const close = sql.indexOf('$$', i + 2);
      out += '?';
      i = close < 0 ? sql.length : close + 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

const TABLE_REFERENCE =
  /\b(?:FROM|INTO|UPDATE|JOIN)\s+((?:[`"]?[A-Za-z_][\w$]{0,63}[`"]?\s*\.\s*)?[`"]?[A-Za-z_][\w$]{0,63}[`"]?)/gi;

/**
 * The statement's first keyword and the names of the tables that follow
 * FROM, INTO, UPDATE and JOIN, read after every literal is removed: never the
 * statement's text nor a value.
 */
export function statementShape(
  sql: string,
): { verb?: string; tables: string[] } | undefined {
  if (typeof sql !== 'string' || sql.length === 0) return undefined;
  const text = maskStatementLiterals(sql.slice(0, MAX_STATEMENT_SCAN));
  const first = /^\s*([A-Za-z]{2,10})\b/.exec(text)?.[1]?.toUpperCase();
  const verb = first && STATEMENT_VERBS.has(first) ? first : undefined;
  const tables: string[] = [];
  for (const match of text.matchAll(TABLE_REFERENCE)) {
    const name = identifier(match[1].replace(/[`"\s]/g, ''));
    if (name && !tables.includes(name)) tables.push(name);
    if (tables.length >= MAX_STATEMENT_TABLES) break;
  }
  if (verb === undefined && tables.length === 0) return undefined;
  return verb === undefined ? { tables } : { verb, tables };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface LoggedError {
  type: string;
  message: string;
  code?: string;
  errno?: string;
  sqlState?: string;
  constraint?: string;
  table?: string;
  column?: string;
  schema?: string;
  routine?: string;
  status?: number;
  statusCode?: number;
  statement?: { verb?: string; tables: string[] };
  stack?: string;
  cause?: LoggedError;
  errors?: LoggedError[];
}

/** A database driver error, or a wrapper or copy of one (a spread of it). */
function looksLikeDriverError(value: Fields): boolean {
  return (
    ('parameters' in value && ('query' in value || 'sql' in value)) ||
    isObject(read(value, 'driverError')) ||
    'sqlMessage' in value ||
    typeof read(value, 'sql') === 'string' ||
    ('severity' in value &&
      'code' in value &&
      ('detail' in value || 'routine' in value))
  );
}

/** An Error, pino's serialized form of one, or a driver error. */
function isErrorLike(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value instanceof Error) return true;
  return (
    (typeof read(value, 'stack') === 'string' &&
      typeof read(value, 'message') === 'string') ||
    looksLikeDriverError(value)
  );
}

/** The `at …` frames of a stack: its first lines repeat the message. */
function framesOf(stack: unknown): string[] {
  if (typeof stack !== 'string') return [];
  return stack
    .slice(0, 16_384)
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .slice(0, MAX_STACK_FRAMES);
}

/** Names that say nothing more than « an error ». */
const GENERIC_TYPES = new Set(['Error', 'error', 'Object']);

/**
 * The most specific of the class, `name` and `type` (pino's serialized form):
 * pg names its DatabaseError `error`, a wrapper may only set `name`.
 */
function typeOf(value: Fields): string {
  const ctor = (value as { constructor?: { name?: unknown } }).constructor;
  const candidates = [
    ctor && typeof ctor.name === 'string' ? ctor.name : undefined,
    read(value, 'name'),
    read(value, 'type'),
  ].map(identifier);
  return (
    candidates.find((c) => c !== undefined && !GENERIC_TYPES.has(c)) ?? 'Error'
  );
}

/** The MySQL key a duplicate-entry message names, as the constraint. */
function mysqlKeyOf(message: string): string | undefined {
  const match = /for key '([^']*)'\s*$/.exec(message.slice(-256));
  return match ? identifier(match[1]) : undefined;
}

function summarize(value: Fields, depth: number): LoggedError {
  const type = typeOf(value);
  const rawMessage = read(value, 'message');
  const messageText = typeof rawMessage === 'string' ? rawMessage : '';
  const message = scrubErrorMessage(messageText);
  const out: LoggedError = { type, message };

  const sources: Fields[] = [value];
  for (const key of NESTED_DRIVER_FIELDS) {
    const nested = read(value, key);
    if (isObject(nested)) sources.push(nested);
  }
  for (const field of IDENTIFIER_FIELDS) {
    for (const source of sources) {
      const kept = identifier(read(source, field));
      if (kept !== undefined) {
        out[field] = kept;
        break;
      }
    }
  }
  if (out.constraint === undefined) {
    const key = mysqlKeyOf(messageText);
    if (key !== undefined) out.constraint = key;
  }
  for (const field of NUMERIC_FIELDS) {
    const status = read(value, field);
    if (typeof status === 'number' && Number.isFinite(status)) {
      out[field] = status;
    }
  }
  for (const source of sources) {
    const sql = read(source, 'query') ?? read(source, 'sql');
    const shape = typeof sql === 'string' ? statementShape(sql) : undefined;
    if (shape) {
      out.statement = shape;
      break;
    }
  }
  // A summary summarized again (the formatter, then the serializer) keeps it.
  const kept = read(value, 'statement');
  if (out.statement === undefined && isObject(kept)) {
    const verb = identifier(read(kept, 'verb'));
    const tables = read(kept, 'tables');
    const names = Array.isArray(tables)
      ? tables
          .map(identifier)
          .filter((t): t is string => t !== undefined)
          .slice(0, MAX_STATEMENT_TABLES)
      : [];
    if (verb !== undefined || names.length > 0) {
      out.statement =
        verb === undefined ? { tables: names } : { verb, tables: names };
    }
  }

  const frames = framesOf(read(value, 'stack'));
  if (frames.length > 0) {
    out.stack = [`${type}: ${message}`, ...frames].join('\n');
  }

  if (depth < MAX_CAUSE_DEPTH) {
    const cause = read(value, 'cause');
    if (isObject(cause)) out.cause = summarize(cause, depth + 1);
    const inner = read(value, 'errors');
    if (Array.isArray(inner)) {
      out.errors = inner
        .slice(0, MAX_INNER_ERRORS)
        .filter(isObject)
        .map((e) => summarize(e, depth + 1));
    }
  }
  return out;
}

interface WalkBudget {
  nodes: number;
}

function isPlainObject(value: unknown): value is Fields {
  if (!isObject(value) || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * `value` with every error it holds summarized, at most 4 levels deep and 500
 * values in all. Arrays and plain objects are copied only when something in
 * them changed; anything else is returned as it is.
 */
function sanitize(value: unknown, depth: number, budget: WalkBudget): unknown {
  budget.nodes += 1;
  if (!isObject(value) || budget.nodes > MAX_WALK_NODES) return value;
  if (isErrorLike(value)) return summarize(value as Fields, 0);
  if (depth >= MAX_WALK_DEPTH) return value;
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item, index) => {
      if (index >= MAX_WALK_ARRAY) return item;
      const next = sanitize(item, depth + 1, budget);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : value;
  }
  if (!isPlainObject(value)) return value;
  let copy: Fields | undefined;
  for (const key of Object.keys(value)) {
    const item = read(value, key);
    const next = sanitize(item, depth + 1, budget);
    if (next !== item) {
      copy ??= { ...value };
      copy[key] = next;
    }
  }
  return copy ?? value;
}

/**
 * The logged form of a value (see the file comment): an error is summarized,
 * a string, a number or a plain object passes through, with the errors the
 * object holds summarized.
 */
export function serializeLoggedError(value: unknown): unknown {
  // A string here can be a stack, whose first line repeats the message
  // (Nest's exception handlers pass one as the context argument).
  if (typeof value === 'string') return redactEngineValues(value);
  return sanitize(value, 0, { nodes: 0 });
}

/**
 * The object of a log line with every error it holds summarized, whatever its
 * key. A driver error spread into the object itself (`{ ...err }`) loses its
 * statement and value fields, and its summary goes under `err`.
 */
export function sanitizeLoggedObject(object: Fields): Fields {
  let base = object;
  if (looksLikeDriverError(object)) {
    const summary = summarize(object, 0);
    base = { ...object };
    for (const key of DRIVER_VALUE_FIELDS) delete base[key];
    delete base.message;
    delete base.stack;
    if (base.err === undefined) base.err = summary;
  }
  // The line's own object is never summarized as an error: its values are.
  const budget: WalkBudget = { nodes: 0 };
  let copy: Fields | undefined;
  for (const key of Object.keys(base)) {
    const item = read(base, key);
    const next = sanitize(item, 0, budget);
    if (next !== item) {
      copy ??= { ...base };
      copy[key] = next;
    }
  }
  return copy ?? base;
}

/** The pino serializers of the keys an error is most often logged under. */
export const LOGGED_ERROR_SERIALIZERS = {
  err: serializeLoggedError,
  error: serializeLoggedError,
  context: serializeLoggedError,
};

/** The error pino would take the line's message from, if any. */
function errorOfLogCall(first: unknown): Fields | undefined {
  if (first instanceof Error) return first as unknown as Fields;
  if (isPlainObject(first) && isErrorLike(read(first, 'err'))) {
    return read(first, 'err') as Fields;
  }
  return undefined;
}

type LogMethod = (this: Logger, ...args: unknown[]) => void;

/**
 * pino's log-method hook. Called with an error and no message, pino copies
 * the error's raw message into the line's `msg`, before any serializer runs:
 * that is how Nest's exception handlers log an unexpected error. The hook
 * gives pino the scrubbed message instead, and replaces the engines' quoted
 * values in any message string.
 */
function logMethod(this: Logger, args: unknown[], method: LogMethod): void {
  const [first, ...rest] = args;
  if (typeof first === 'string') {
    method.apply(this, [redactEngineValues(first), ...rest]);
    return;
  }
  let object: unknown = first instanceof Error ? { err: first } : first;
  const ownMessage = isPlainObject(object) ? read(object, 'msg') : undefined;
  if (typeof ownMessage === 'string') {
    object = { ...(object as Fields), msg: redactEngineValues(ownMessage) };
  }
  const [second, ...others] = rest;
  if (typeof second === 'string') {
    method.apply(this, [object, redactEngineValues(second), ...others]);
    return;
  }
  const error = errorOfLogCall(first);
  if (error !== undefined && second === undefined && ownMessage === undefined) {
    const raw = read(error, 'message');
    method.apply(this, [
      object,
      scrubErrorMessage(typeof raw === 'string' ? raw : ''),
    ]);
    return;
  }
  method.apply(this, [object, ...rest]);
}

/**
 * What every service's `createLoggerOptions` adds: the serializers, the
 * log-method hook and the log formatter. pino-http's child loggers inherit
 * the hook and the formatter.
 */
export const LOGGED_ERROR_LOGGER_OPTIONS: Pick<
  LoggerOptions,
  'serializers' | 'hooks' | 'formatters'
> = {
  serializers: LOGGED_ERROR_SERIALIZERS,
  hooks: {
    logMethod: logMethod as NonNullable<LoggerOptions['hooks']>['logMethod'],
  },
  formatters: { log: sanitizeLoggedObject },
};

// ---------------------------------------------------------------------------
// The request bound to every line of the HTTP logger
// ---------------------------------------------------------------------------

/** pino's serialized request, as pino-http hands it to a request serializer. */
interface SerializedRequest {
  id?: unknown;
  method?: unknown;
  url?: unknown;
  headers?: Record<string, unknown>;
}

function header(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const value = headers?.[name];
  return typeof value === 'string' ? value.slice(0, 256) : undefined;
}

/**
 * The request fields bound to every line written while it is served: its id,
 * method, path without the query string, user agent, content type and length.
 * Nothing else: no other header (they carry tokens, signatures and session
 * ids) and no query value.
 */
export function requestSummary(req: SerializedRequest): Fields {
  const url = typeof req.url === 'string' ? req.url : '';
  const query = url.indexOf('?');
  return {
    id:
      typeof req.id === 'string' || typeof req.id === 'number'
        ? req.id
        : undefined,
    method: typeof req.method === 'string' ? req.method : undefined,
    url: (query < 0 ? url : url.slice(0, query)).slice(0, 512),
    userAgent: header(req.headers, 'user-agent'),
    contentType: header(req.headers, 'content-type'),
    contentLength: header(req.headers, 'content-length'),
  };
}

/** The response fields of the HTTP logger: its status only. */
export function responseSummary(res: { statusCode?: unknown }): Fields {
  return {
    statusCode: typeof res.statusCode === 'number' ? res.statusCode : undefined,
  };
}

/**
 * The pino-http options of the service. nestjs-pino takes its root logger
 * from this pino-http instance, so every line goes through it, inside a
 * request or not, and pino-http puts its own `err`, `req` and `res`
 * serializers in front of the logger's unless it is given them here.
 */
export function createHttpLoggerOptions(logger: Logger): {
  logger: Logger;
  autoLogging: false;
  serializers: typeof LOGGED_ERROR_SERIALIZERS & {
    req: typeof requestSummary;
    res: typeof responseSummary;
  };
} {
  return {
    logger,
    autoLogging: false,
    serializers: {
      ...LOGGED_ERROR_SERIALIZERS,
      req: requestSummary,
      res: responseSummary,
    },
  };
}
