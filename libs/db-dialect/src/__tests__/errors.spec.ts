import { isDeadlock, isLockTimeout, isUniqueViolation } from '../index';

describe('errors', () => {
  it.each([
    { code: 'ER_DUP_ENTRY' },
    { errno: 1062 },
    { code: '23505' },
    { driverError: { code: '23505' } },
    { driverError: { errno: 1062 } },
    { driverError: { code: 'ER_DUP_ENTRY' } },
  ])('isUniqueViolation(%j) is true', (e) => {
    expect(isUniqueViolation(e)).toBe(true);
  });

  it('isUniqueViolation rejects other errors', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation({ errno: 1451 })).toBe(false);
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('ER_DUP_ENTRY')).toBe(false);
  });

  it.each([
    { code: 'ER_LOCK_DEADLOCK' },
    { errno: 1213 },
    { code: '40P01' },
    { code: '40001' },
    { driverError: { code: '40P01' } },
    { driverError: { errno: 1213 } },
  ])('isDeadlock(%j) is true', (e) => {
    expect(isDeadlock(e)).toBe(true);
  });

  it('isDeadlock rejects other errors', () => {
    expect(isDeadlock({ code: '23505' })).toBe(false);
    expect(isDeadlock({ errno: 1062 })).toBe(false);
    expect(isDeadlock(new Error('x'))).toBe(false);
    expect(isDeadlock(null)).toBe(false);
  });

  it.each([
    { code: 'ER_LOCK_WAIT_TIMEOUT' },
    { errno: 1205 },
    { code: '55P03' },
    { driverError: { code: '55P03' } },
    { driverError: { errno: 1205 } },
  ])('isLockTimeout(%j) is true', (e) => {
    expect(isLockTimeout(e)).toBe(true);
  });

  it('isLockTimeout rejects other errors', () => {
    expect(isLockTimeout({ code: '40P01' })).toBe(false);
    expect(isLockTimeout({ errno: 1213 })).toBe(false);
    expect(isLockTimeout(new Error('x'))).toBe(false);
    expect(isLockTimeout(null)).toBe(false);
  });
});
