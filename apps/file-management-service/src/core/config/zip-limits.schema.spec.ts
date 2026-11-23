import { validationSchema } from './validation.schema';
import { DEFAULT_ZIP_LIMITS, ZIP_LIMIT_ENV } from '../../file/zip-limits.util';

describe('full-scan archive limits', () => {
  it.each(Object.entries(ZIP_LIMIT_ENV))(
    '%s (%s) defaults to the code default',
    (limit, variable) => {
      const schema = validationSchema.extract(variable);
      expect(schema.validate(undefined).value).toBe(
        DEFAULT_ZIP_LIMITS[limit as keyof typeof DEFAULT_ZIP_LIMITS],
      );
    },
  );

  it.each(Object.values(ZIP_LIMIT_ENV))(
    '%s takes a positive integer',
    (variable) => {
      const schema = validationSchema.extract(variable);
      expect(schema.validate('1048576').value).toBe(1048576);
      expect(schema.validate('0').error).toBeDefined();
      expect(schema.validate('-1').error).toBeDefined();
      expect(schema.validate('1.5').error).toBeDefined();
      expect(schema.validate('lots').error).toBeDefined();
    },
  );
});
