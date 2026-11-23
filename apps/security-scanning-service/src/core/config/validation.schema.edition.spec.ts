import { validationSchema } from './validation.schema';

/**
 * In the Community Edition the service runs no scanner pods, no
 * AI agent client and no scan-IP allow-list (they are closed), so
 * their settings are not required. The cloud edition still requires them.
 */
describe('validation schema per edition', () => {
  // Everything the schema requires in both editions, except the three
  // closed-service keys under test (KUBERNETES_ENV, GRPC_URL_AGENT_SERVICE,
  // ALLOWED_SCAN_IPS) and their dependent keys.
  const base = {
    GRPC_URL_GLOBAL_MANAGEMENT_SERVICE: 'x',
    GRPC_URL_SECURITY_SCANNING_SERVICE: 'x',
    GRPC_URL_FILE_MANAGEMENT_SERVICE: 'x',
    GCR_NAME: 'gcr.invalid',
    GCP_BUCKET_NAME: 'bucket',
    OTEL_DISABLED: 'true',
  };

  it('needs no Kubernetes, agent or scan-IP setting in community mode', () => {
    const { error } = validationSchema.validate({
      ...base,
      CYBEDEFEND_EDITION: 'community',
    });
    expect(error).toBeUndefined();
  });

  it('still requires them in the cloud', () => {
    const { error } = validationSchema.validate(base, { abortEarly: false });
    expect(error?.message).toContain('"KUBERNETES_ENV" is required');
    expect(error?.message).toContain('"GRPC_URL_AGENT_SERVICE" is required');
    expect(error?.message).toContain('"ALLOWED_SCAN_IPS" is required');
  });

  it('still requires them in the enterprise edition', () => {
    const { error } = validationSchema.validate(
      { ...base, CYBEDEFEND_EDITION: 'enterprise' },
      { abortEarly: false },
    );
    expect(error?.message).toContain('"KUBERNETES_ENV" is required');
    expect(error?.message).toContain('"GRPC_URL_AGENT_SERVICE" is required');
    expect(error?.message).toContain('"ALLOWED_SCAN_IPS" is required');
  });

  it('accepts them in community mode when they are set', () => {
    const { error } = validationSchema.validate({
      ...base,
      CYBEDEFEND_EDITION: 'community',
      KUBERNETES_ENV: 'kubeconfig',
      SCAN_IMAGE_REGISTRY: 'registry.invalid',
      GRPC_URL_AGENT_SERVICE: 'x',
      ALLOWED_SCAN_IPS: '127.0.0.1',
    });
    expect(error).toBeUndefined();
  });
});
