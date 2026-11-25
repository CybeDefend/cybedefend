import { SpanStatusCode, type Span } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  DATABASE_INSTRUMENTATION_CONFIG,
  maskStatement,
  RedactingSpanProcessor,
} from './trace-redaction';

/**
 * A span leaves the service without a value of a statement or of a failed
 * statement's error: the database instrumentations record the statement with
 * every literal masked (mysql2 would otherwise format the bound values into
 * it, on success too), and the processor scrubs the status message, the
 * exception events (the instrumentations' and `@Span()`'s) and the statement
 * attributes before export.
 *
 * Not exercised here: the instrumentations themselves patching a live driver.
 * The spec checks the options they are given and the hook they call.
 */

const EMAIL = 'jane.doe+private@example.test';
const SQL_WITH_VALUES = `INSERT INTO \`user\` (\`id\`, \`email\`, \`age\`) VALUES ('u1', '${EMAIL}', 42)`;

describe('maskStatement', () => {
  it('replaces every literal, keeps the statement and the table', () => {
    const masked = maskStatement(SQL_WITH_VALUES);

    expect(masked).toBe(
      'INSERT INTO `user` (`id`, `email`, `age`) VALUES (?, ?, ?)',
    );
  });

  it('keeps the placeholders and identifiers of a PostgreSQL statement', () => {
    expect(
      maskStatement(
        `SELECT "u"."id" FROM "user" "u" WHERE "u"."email" = $1 AND "u"."note" = 'x${EMAIL}' LIMIT 10`,
      ),
    ).toBe(
      'SELECT "u"."id" FROM "user" "u" WHERE "u"."email" = $1 AND "u"."note" = ? LIMIT ?',
    );
  });
});

describe('the database instrumentation options', () => {
  it('make mysql2 record the masked statement, never the formatted values', () => {
    const mysql2 =
      DATABASE_INSTRUMENTATION_CONFIG['@opentelemetry/instrumentation-mysql2'];

    expect(mysql2.maskStatement).toBe(true);
    expect(mysql2.maskStatementHook(SQL_WITH_VALUES)).not.toContain(EMAIL);
  });

  it('make pg and mysql record no value and pg the masked statement', () => {
    const pg =
      DATABASE_INSTRUMENTATION_CONFIG['@opentelemetry/instrumentation-pg'];
    const attributes: Record<string, unknown> = {};
    const span = {
      setAttribute: (key: string, value: unknown) => {
        attributes[key] = value;
      },
    } as unknown as Span;

    pg.requestHook(span, {
      query: { text: `SELECT 1 FROM "user" WHERE "email" = '${EMAIL}'` },
    });

    expect(pg.enhancedDatabaseReporting).toBe(false);
    expect(
      DATABASE_INSTRUMENTATION_CONFIG['@opentelemetry/instrumentation-mysql']
        .enhancedDatabaseReporting,
    ).toBe(false);
    expect(attributes['db.query.text']).toBe(
      'SELECT ? FROM "user" WHERE "email" = ?',
    );
  });
});

describe('RedactingSpanProcessor', () => {
  it('exports a failed statement’s span without its values', () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [
        new RedactingSpanProcessor(new SimpleSpanProcessor(exporter)),
      ],
    });
    const error = Object.assign(
      new Error(
        `Duplicate entry '${EMAIL}' for key 'user.IDX_user_email_unique'`,
      ),
      { code: 'ER_DUP_ENTRY' },
    );

    const span = provider.getTracer('spec').startSpan('mysql INSERT');
    span.setAttribute('db.statement', SQL_WITH_VALUES);
    span.setAttribute('db.query.text', SQL_WITH_VALUES);
    // What the mysql2 instrumentation and @Span() do with an error.
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.end();

    const [exported] = exporter.getFinishedSpans();
    const text = JSON.stringify({
      attributes: exported.attributes,
      status: exported.status,
      events: exported.events,
    });
    expect(text).not.toContain(EMAIL);
    expect(exported.attributes['db.statement']).toBe(
      'INSERT INTO `user` (`id`, `email`, `age`) VALUES (?, ?, ?)',
    );
    expect(exported.attributes['db.query.text']).toBe(
      'INSERT INTO `user` (`id`, `email`, `age`) VALUES (?, ?, ?)',
    );
    expect(exported.status.message).toBe(
      "Duplicate entry '[redacted]' for key 'user.IDX_user_email_unique'",
    );
    expect(exported.events[0].attributes?.['exception.stacktrace']).toContain(
      'trace-redaction.spec',
    );
  });
});
