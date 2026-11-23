import { validationSchema } from './validation.schema';

// Smallest env that satisfies the unrelated `.required()` keys (same shape
// as validation.schema.spec.ts), so each assertion below is only ever about
// DB_TYPE.
function baseEnv(): Record<string, string> {
  return {
    GRPC_URL_SECURITY_SCANNING_SERVICE: 'localhost:50053',
    ALLOWED_SCAN_IPS: '127.0.0.1',
    GATEWAY_URL: 'http://localhost:3000',
    OTEL_DISABLED: 'true',
  };
}

describe('DB_TYPE validation', () => {
  it('defaults to mysql (the cloud)', () => {
    const { error, value } = validationSchema.validate(baseEnv());
    expect(error).toBeUndefined();
    expect(value.DB_TYPE).toBe('mysql');
  });

  it('accepts postgres', () => {
    const { error, value } = validationSchema.validate({
      ...baseEnv(),
      DB_TYPE: 'postgres',
    });
    expect(error).toBeUndefined();
    expect(value.DB_TYPE).toBe('postgres');
  });

  it('rejects another engine with a message naming DB_TYPE', () => {
    const { error } = validationSchema.validate({
      ...baseEnv(),
      DB_TYPE: 'oracle',
    });
    expect(error).toBeDefined();
    expect(error?.message).toContain('DB_TYPE');
  });
});
