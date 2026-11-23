import { validationSchema } from './validation.schema';

/**
 * The closed agent and billing gRPC clients live in the closed modules,
 * so their URLs are required only outside the Community Edition.
 */
describe('the closed gRPC URL keys', () => {
  // The smallest object the rest of the schema accepts.
  const minimal = {
    GRPC_URL_ANALYSIS_REPORTING_SERVICE: '127.0.0.1:50054',
    GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:50055',
    GRPC_URL_GLOBAL_MANAGEMENT_SERVICE: '127.0.0.1:50052',
    OTEL_DISABLED: 'true',
  };

  it('requires the agent and billing URLs in the cloud', () => {
    const { error } = validationSchema.validate(
      { ...minimal, CYBEDEFEND_EDITION: undefined },
      { abortEarly: false },
    );
    expect(error?.message).toMatch(/GRPC_URL_AGENT_SERVICE/);
    expect(error?.message).toMatch(/GRPC_URL_BILLING_SERVICE/);
  });

  it('does not require them in community', () => {
    const { error } = validationSchema.validate({
      ...minimal,
      CYBEDEFEND_EDITION: 'community',
    });
    expect(error).toBeUndefined();
  });
});

/**
 * FRONTEND_URL: the instance's public URL, the base of every dashboard link
 * (issue tickets, report deep links). The Community compose passes it from
 * CYBEDEFEND_PUBLIC_URL; the cloud resolves its own host.
 */
describe('FRONTEND_URL', () => {
  const community = {
    CYBEDEFEND_EDITION: 'community',
    GRPC_URL_ANALYSIS_REPORTING_SERVICE: '127.0.0.1:50054',
    GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:50055',
    GRPC_URL_GLOBAL_MANAGEMENT_SERVICE: '127.0.0.1:50052',
    OTEL_DISABLED: 'true',
  };

  it('defaults to http://localhost:8080 in community', () => {
    const { error, value } = validationSchema.validate(community);
    expect(error).toBeUndefined();
    expect(value.FRONTEND_URL).toBe('http://localhost:8080');
  });

  it('keeps the configured value in community, and lets a bad one reach the fallback instead of failing the boot', () => {
    for (const url of ['https://appsec.example.org/', 'ftp://x', '']) {
      const { error, value } = validationSchema.validate({
        ...community,
        FRONTEND_URL: url,
      });
      expect(error).toBeUndefined();
      expect(value.FRONTEND_URL).toBe(url);
    }
  });

  it('gives the cloud no default', () => {
    const { value } = validationSchema.validate({
      ...community,
      CYBEDEFEND_EDITION: 'cloud',
    });
    expect(value.FRONTEND_URL).toBeUndefined();
  });
});
