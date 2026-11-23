import { validationSchema } from './validation.schema';

describe('DB_TYPE validation', () => {
  const schema = validationSchema.extract('DB_TYPE');

  it('defaults to mysql', () => {
    expect(schema.validate(undefined).value).toBe('mysql');
  });

  it.each(['mysql', 'postgres'])('accepts %s', (value) => {
    expect(schema.validate(value).error).toBeUndefined();
    expect(schema.validate(value).value).toBe(value);
  });

  it('refuses any other engine, with a message naming DB_TYPE', () => {
    const { error } = validationSchema.validate(
      { DB_TYPE: 'oracle' },
      { abortEarly: false },
    );
    expect(error).toBeDefined();
    expect(error?.details.some((d) => d.message.includes('DB_TYPE'))).toBe(
      true,
    );
  });
});
