import { decimalToNumberTransformer } from './decimal-transformer';

describe('decimalToNumberTransformer', () => {
  describe('from (DB → entity)', () => {
    it('converts a decimal string to a number', () => {
      expect(decimalToNumberTransformer.from('0.50')).toBe(0.5);
      expect(decimalToNumberTransformer.from('10.00')).toBe(10);
      expect(decimalToNumberTransformer.from('0.0123')).toBe(0.0123);
    });

    it('returns null for null and undefined inputs', () => {
      expect(decimalToNumberTransformer.from(null)).toBeNull();
      expect(decimalToNumberTransformer.from(undefined as never)).toBeNull();
    });

    it('passes a number through unchanged (defensive)', () => {
      expect(decimalToNumberTransformer.from(7.5)).toBe(7.5);
      expect(decimalToNumberTransformer.from(0)).toBe(0);
    });

    it('produces a number that compares strictly with computed values', () => {
      // The bug being fixed: '0.50' !== 0.5 in JS. After the transformer,
      // a strict comparison must short-circuit when values match.
      const stored = decimalToNumberTransformer.from('0.50');
      expect(stored !== 0.5).toBe(false);
    });
  });

  describe('to (entity → DB)', () => {
    it('passes numbers through unchanged', () => {
      expect(decimalToNumberTransformer.to(0.5)).toBe(0.5);
      expect(decimalToNumberTransformer.to(0)).toBe(0);
    });

    it('returns null for null and undefined inputs', () => {
      expect(decimalToNumberTransformer.to(null)).toBeNull();
      expect(decimalToNumberTransformer.to(undefined)).toBeNull();
    });
  });
});
