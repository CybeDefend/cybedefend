import { registerPostgresTypeParsers } from '../index';

it('registers timestamp as UTC and int8/numeric as strings', () => {
  const calls: Array<[number, (value: string) => unknown]> = [];
  const registry = {
    setTypeParser: (oid: number, parser: (value: string) => unknown) => {
      calls.push([oid, parser]);
    },
  };
  registerPostgresTypeParsers(registry);
  expect(calls.map((c) => c[0]).sort((x, y) => x - y)).toEqual([20, 1114, 1700]);

  const ts = calls.find((c) => c[0] === 1114)![1];
  expect(ts('2026-11-02 10:00:00.123')).toEqual(new Date('2026-11-02T10:00:00.123Z'));
  expect((ts('2026-11-02 10:00:00.123') as Date).getTime()).toBe(
    new Date('2026-11-02T10:00:00.123Z').getTime(),
  );

  const int8 = calls.find((c) => c[0] === 20)![1];
  expect(int8('9223372036854775807')).toBe('9223372036854775807');

  const numeric = calls.find((c) => c[0] === 1700)![1];
  expect(numeric('1.50')).toBe('1.50');
});
