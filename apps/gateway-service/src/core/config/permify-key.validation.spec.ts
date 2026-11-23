import { validationSchema } from './validation.schema';

describe('the Permify preshared key is a registered variable', () => {
  it.each(['PERMIFY_PRESHARED_KEY', 'PERMIFY_PRESHARED_KEY_FILE'])(
    '%s is declared, optional, and may be empty',
    (key) => {
      const rule = validationSchema.extract(key);
      expect(rule.validate(undefined).error).toBeUndefined();
      expect(rule.validate('').error).toBeUndefined();
      expect(rule.validate('a-value').error).toBeUndefined();
    },
  );
});
