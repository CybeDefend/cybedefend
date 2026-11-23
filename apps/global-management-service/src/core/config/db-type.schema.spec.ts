import { validationSchema } from './validation.schema';

// The minimal environment the whole schema accepts (same keys as the boot
// specs of src/edition): the secrets block, the gRPC URLs, Permify, the
// frontend and OTEL disabled.
const MINIMAL_ENV: Record<string, string> = {
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  GRPC_URL_ANALYSIS_REPORTING_SERVICE: '127.0.0.1:1',
  GRPC_URL_EXTERNAL_INTEGRATIONS_SERVICE: '127.0.0.1:1',
  PERMIFY_ENDPOINT: '127.0.0.1:1',
  FRONTEND_URL: 'http://127.0.0.1:1',
  OTEL_DISABLED: 'true',
};

describe('DB_TYPE validation', () => {
  it('defaults to mysql', () => {
    const { error, value } = validationSchema.validate(MINIMAL_ENV);
    expect(error).toBeUndefined();
    expect(value.DB_TYPE).toBe('mysql');
  });

  it('accepts postgres', () => {
    const { error, value } = validationSchema.validate({
      ...MINIMAL_ENV,
      DB_TYPE: 'postgres',
    });
    expect(error).toBeUndefined();
    expect(value.DB_TYPE).toBe('postgres');
  });

  it('rejects any other engine with a message naming DB_TYPE', () => {
    const { error } = validationSchema.validate({
      ...MINIMAL_ENV,
      DB_TYPE: 'oracle',
    });
    expect(error).toBeDefined();
    expect(error?.message).toContain('DB_TYPE');
  });
});
