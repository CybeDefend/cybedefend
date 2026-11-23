import { validationSchema } from './validation.schema';

// ─── DB_SSL_ENABLED must survive Joi as a STRING ──────────────────────
//
// The chart injects DB_SSL_ENABLED as the string "true" (global.dbSslEnabled)
// and app.module.ts decides on TLS with:
//
//     String(configService.get<string>('DB_SSL_ENABLED')) === 'true'
//
// Declaring the key as Joi.boolean() would make Joi COERCE "true" into the
// boolean true, so that comparison would read `true === 'true'` → false: the
// service would connect without TLS while its config says TLS is on, and the
// "certificates are missing" start-up guard could never fire because it is
// gated on the very same false flag.
//
// Two independent guarantees are locked in below, on purpose: the schema keeps
// the value a string, AND the predicate the app actually runs is written so it
// no longer cares. Either one alone would leave the trap re-armable.

describe('DB_SSL_ENABLED validation', () => {
  const key = () => validationSchema.extract('DB_SSL_ENABLED');

  it('keeps "true" as a string — Joi.boolean() would coerce it and silently disable TLS', () => {
    const { error, value } = key().validate('true');
    expect(error).toBeUndefined();
    expect(value).toBe('true');
    expect(typeof value).toBe('string');
  });

  it('keeps "false" as a string', () => {
    const { error, value } = key().validate('false');
    expect(error).toBeUndefined();
    expect(value).toBe('false');
  });

  it('defaults to "false" when the chart does not set it', () => {
    const { value } = key().validate(undefined);
    expect(value).toBe('false');
  });

  it('rejects anything that is not exactly "true" or "false"', () => {
    // A typo used to be coerced or silently ignored; it must now fail at boot.
    expect(key().validate('True').error).toBeDefined();
    expect(key().validate('1').error).toBeDefined();
    expect(key().validate('yes').error).toBeDefined();
  });

  it('feeds the predicate app.module.ts actually evaluates', () => {
    const enabled = validationSchema
      .extract('DB_SSL_ENABLED')
      .validate('true').value;
    // The exact expression used at the TypeORM factory call site.
    expect(String(enabled) === 'true').toBe(true);
  });
});
