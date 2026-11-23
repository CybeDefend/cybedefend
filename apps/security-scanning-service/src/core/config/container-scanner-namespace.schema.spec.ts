import { validationSchema } from './validation.schema';

// The image scanner pods run in CONTAINER_SCANNER_NAMESPACE (kubernete.service.ts
// containerScannerNamespace). Unset, they stay in scanners-namespace. A name
// Kubernetes would refuse must stop the boot, not fail every image scan later.
describe('CONTAINER_SCANNER_NAMESPACE validation', () => {
  const key = () => validationSchema.extract('CONTAINER_SCANNER_NAMESPACE');

  it('defaults to scanners-namespace', () => {
    const { error, value } = key().validate(undefined);
    expect(error).toBeUndefined();
    expect(value).toBe('scanners-namespace');
  });

  it('accepts a namespace name', () => {
    const { error, value } = key().validate('scanners-container-namespace');
    expect(error).toBeUndefined();
    expect(value).toBe('scanners-container-namespace');
  });

  it.each(['Scanners', 'scanners/namespace', '-scanners', 'a'.repeat(64)])(
    'refuses %s, which is no Kubernetes namespace name',
    (name) => {
      expect(key().validate(name).error).toBeDefined();
    },
  );
});

// The FQDN engine of the image scanner pods' egress policies
// (kubernete.service.ts, container-egress-policy.ts). Unset = no pod policy.
describe('CONTAINER_SCAN_EGRESS_POLICY validation', () => {
  const key = () => validationSchema.extract('CONTAINER_SCAN_EGRESS_POLICY');

  it('is optional', () => {
    expect(key().validate(undefined).error).toBeUndefined();
  });

  it.each(['cilium', 'gke'])('accepts %s', (engine) => {
    expect(key().validate(engine).error).toBeUndefined();
  });

  it('refuses any other engine', () => {
    expect(key().validate('calico').error).toBeDefined();
  });
});

// The address of each scanner family's envoy listener (kubernete.service.ts
// scannerGrpcUrl). Optional; a value that is no host:port must stop the boot.
describe.each([
  'SCANNER_GRPC_URL_SAST_IAC',
  'SCANNER_GRPC_URL_SCA',
  'SCANNER_GRPC_URL_AIBOM',
  'SCANNER_GRPC_URL_CONTAINER',
])('%s validation', (name) => {
  const key = () => validationSchema.extract(name);

  it('is optional', () => {
    expect(key().validate(undefined).error).toBeUndefined();
  });

  it('accepts a host:port', () => {
    const url = 'envoy-grpc-gateway.scanners.example:18201';
    expect(key().validate(url).value).toBe(url);
  });

  it.each(['envoy', 'http://envoy:18201', 'envoy:port', 'envoy:18201/x'])(
    'refuses %s',
    (value) => {
      expect(key().validate(value).error).toBeDefined();
    },
  );
});
