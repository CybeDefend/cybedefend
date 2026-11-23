import { validationSchema } from './validation.schema';

describe('CYBEDEFEND_EDITION', () => {
  const schema = validationSchema.extract('CYBEDEFEND_EDITION');

  it('defaults CYBEDEFEND_EDITION to cloud', () => {
    expect(schema.validate(undefined).value).toBe('cloud');
  });

  it.each(['community', 'cloud', 'enterprise'])('accepts %s', (edition) => {
    expect(schema.validate(edition).error).toBeUndefined();
  });

  it('refuses any other value', () => {
    expect(schema.validate('saas').error).toBeDefined();
  });
});
