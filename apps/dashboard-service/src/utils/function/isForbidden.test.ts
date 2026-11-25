import { describe, expect, it } from 'vitest';
import { isForbidden } from './isForbidden';

describe('isForbidden', () => {
  it.each([
    [{ isAxiosError: true, response: { status: 403, data: {} } }],
    [{ statusCode: 403, message: 'Forbidden' }],
    [{ status: 403 }],
  ])('is true for a refusal of the caller rights: %j', (error) => {
    expect(isForbidden(error)).toBe(true);
  });

  it.each([
    [{ response: { status: 401 } }],
    [{ response: { status: 404 } }],
    [{ response: { status: 500 } }],
    [{ statusCode: 400 }],
    [new Error('network')],
    [null],
    ['403'],
  ])('is false otherwise: %j', (error) => {
    expect(isForbidden(error)).toBe(false);
  });
});
