import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { assertPasswordPolicy } from './password-policy';

/** 12 to 128 code points, else PASSWORD_POLICY (INVALID_ARGUMENT). */
describe('assertPasswordPolicy', () => {
  function refusalOf(password: string): { code: number; message: string } {
    let thrown: unknown;
    try {
      assertPasswordPolicy(password);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RpcException);
    return (thrown as RpcException).getError() as {
      code: number;
      message: string;
    };
  }

  it('refuses 11 characters with PASSWORD_POLICY', () => {
    expect(refusalOf('a'.repeat(11))).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'PASSWORD_POLICY',
    });
  });

  it('accepts 12 characters', () => {
    expect(() => assertPasswordPolicy('a'.repeat(12))).not.toThrow();
  });

  it('accepts 128 code points, accents included', () => {
    expect(() => assertPasswordPolicy('é'.repeat(128))).not.toThrow();
  });

  it('refuses 129 characters', () => {
    expect(refusalOf('a'.repeat(129))).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'PASSWORD_POLICY',
    });
  });

  it('counts code points, not UTF-16 units: 12 emoji pass', () => {
    expect(() => assertPasswordPolicy('👍'.repeat(12))).not.toThrow();
    expect(refusalOf('👍'.repeat(129)).message).toBe('PASSWORD_POLICY');
  });
});
