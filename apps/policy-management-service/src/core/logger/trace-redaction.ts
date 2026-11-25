import type { Context, Span } from '@opentelemetry/api';
import type {
  ReadableSpan,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  maskStatementLiterals,
  redactEngineValues,
  scrubErrorMessage,
} from './logged-error';

/**
 * What the traces may carry of a statement and of an error, the same in
 * every service.
 *
 * - The mysql2 instrumentation records each statement with its bound values
 *   formatted into it unless `maskStatement` is on; the pg one records the
 *   statement's text (literals included) and, with
 *   `enhancedDatabaseReporting`, the values. Both are told to record the
 *   statement with every literal replaced by `?`.
 * - The instrumentations, and the `@Span()` decorator, record an exception
 *   with its raw message and stack, and set the span's status to the raw
 *   message. `RedactingSpanProcessor` replaces the value an engine's message
 *   quotes in each of them, and masks the statement attributes again, before
 *   a span is exported.
 */

/** The attributes the database instrumentations write a statement to. */
const STATEMENT_ATTRIBUTES = ['db.statement', 'db.query.text'] as const;

const MAX_STATEMENT_LENGTH = 2048;

/** The statement with every literal (strings, numbers) replaced by `?`. */
export function maskStatement(sql: string): string {
  const masked = maskStatementLiterals(
    sql.length > MAX_STATEMENT_LENGTH * 2
      ? sql.slice(0, MAX_STATEMENT_LENGTH * 2)
      : sql,
  ).replace(/(?<![\w$.])-?\d+(?:\.\d+)?(?:e[+-]?\d+)?(?![\w$])/gi, '?');
  return masked.length > MAX_STATEMENT_LENGTH
    ? `${masked.slice(0, MAX_STATEMENT_LENGTH)}…`
    : masked;
}

/**
 * The options of the database instrumentations, to merge into the
 * configuration given to `getNodeAutoInstrumentations`.
 */
export const DATABASE_INSTRUMENTATION_CONFIG = {
  '@opentelemetry/instrumentation-mysql2': {
    maskStatement: true,
    maskStatementHook: maskStatement,
  },
  '@opentelemetry/instrumentation-mysql': {
    enhancedDatabaseReporting: false,
  },
  '@opentelemetry/instrumentation-pg': {
    enhancedDatabaseReporting: false,
    requestHook: (span: Span, info: { query: { text: string } }): void => {
      span.setAttribute('db.query.text', maskStatement(info.query.text));
    },
  },
};

interface MutableEvent {
  name: string;
  attributes?: Record<string, unknown>;
}

/** The span's status message, exception events and statements, scrubbed in place. */
export function redactSpan(span: ReadableSpan): void {
  const status = span.status as { message?: string };
  if (typeof status?.message === 'string') {
    status.message = scrubErrorMessage(status.message);
  }
  for (const event of span.events as MutableEvent[]) {
    if (event.name !== 'exception' || !event.attributes) continue;
    const message = event.attributes['exception.message'];
    if (typeof message === 'string') {
      event.attributes['exception.message'] = scrubErrorMessage(message);
    }
    const stack = event.attributes['exception.stacktrace'];
    if (typeof stack === 'string') {
      // The stack's first line repeats the message.
      event.attributes['exception.stacktrace'] = redactEngineValues(stack);
    }
  }
  const attributes = span.attributes as Record<string, unknown>;
  for (const key of STATEMENT_ATTRIBUTES) {
    const statement = attributes[key];
    if (typeof statement === 'string') {
      attributes[key] = maskStatement(statement);
    }
  }
}

/** Scrubs each span (see `redactSpan`) before handing it to the next processor. */
export class RedactingSpanProcessor implements SpanProcessor {
  constructor(private readonly delegate: SpanProcessor) {}

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }

  onStart(span: Span & ReadableSpan, parentContext: Context): void {
    this.delegate.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    redactSpan(span);
    this.delegate.onEnd(span);
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
}
