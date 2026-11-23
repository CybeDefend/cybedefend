import {
  buildScannerPodManifest,
  ScannerPodManifestInput,
} from './scanner-pod-manifest';

const minimal: ScannerPodManifestInput = {
  name: 'cd-scan-opengrep-c1',
  labels: { 'app.kubernetes.io/managed-by': 'cybedefend' },
  image: 'ghcr.io/cybedefend/cybedefend-scanners/opengrep:1.0.0',
  imagePullPolicy: 'IfNotPresent',
  env: [{ name: 'CYBEDEFEND_SCAN_ID', value: 's1' }],
  resources: { requests: { cpu: '500m' }, limits: { cpu: '1' } },
  emptyDirs: [],
  readOnlyRootFilesystem: false,
};

describe('buildScannerPodManifest', () => {
  it('hardens every pod', () => {
    const pod = buildScannerPodManifest(minimal);
    expect(pod.spec).toMatchObject({
      automountServiceAccountToken: false,
      restartPolicy: 'Never',
      securityContext: { seccompProfile: { type: 'RuntimeDefault' } },
    });
    expect(pod.spec.containers[0].securityContext).toStrictEqual({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ['ALL'] },
    });
  });

  it('sets a read-only root filesystem when asked', () => {
    const pod = buildScannerPodManifest({
      ...minimal,
      readOnlyRootFilesystem: true,
    });
    expect(pod.spec.containers[0].securityContext).toStrictEqual({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ['ALL'] },
      readOnlyRootFilesystem: true,
    });
  });

  it('runs as the given non-root uid', () => {
    expect(
      buildScannerPodManifest({ ...minimal, runAsUser: 65532 }).spec
        .securityContext,
    ).toEqual({
      seccompProfile: { type: 'RuntimeDefault' },
      runAsNonRoot: true,
      runAsUser: 65532,
      runAsGroup: 65532,
      fsGroup: 65532,
    });
  });

  it('without a uid, sets no user, group or non-root flag (the cloud images run as root)', () => {
    expect(buildScannerPodManifest(minimal).spec.securityContext).toStrictEqual(
      { seccompProfile: { type: 'RuntimeDefault' } },
    );
  });

  it('mounts each emptyDir', () => {
    const pod = buildScannerPodManifest({
      ...minimal,
      emptyDirs: [
        { name: 'src', mountPath: '/src' },
        { name: 'work', mountPath: '/tmp/cybedefend-scanner' },
      ],
    });
    expect(pod.spec.volumes).toStrictEqual([
      { name: 'src', emptyDir: {} },
      { name: 'work', emptyDir: {} },
    ]);
    expect(pod.spec.containers[0].volumeMounts).toStrictEqual([
      { mountPath: '/src', name: 'src' },
      { mountPath: '/tmp/cybedefend-scanner', name: 'work' },
    ]);
  });

  it('carries name, labels, image, pull policy, env and resources on one container named scanner', () => {
    const pod = buildScannerPodManifest(minimal);
    expect(pod.metadata).toStrictEqual({
      name: minimal.name,
      labels: minimal.labels,
    });
    expect(pod.spec.containers).toHaveLength(1);
    expect(pod.spec.containers[0]).toMatchObject({
      name: 'scanner',
      image: minimal.image,
      imagePullPolicy: 'IfNotPresent',
      env: minimal.env,
      resources: minimal.resources,
    });
  });

  it('sets the pull secrets, command, args and deadline only when given', () => {
    const bare = buildScannerPodManifest(minimal);
    expect(bare.spec).not.toHaveProperty('imagePullSecrets');
    expect(bare.spec).not.toHaveProperty('activeDeadlineSeconds');
    expect(bare.spec.containers[0]).not.toHaveProperty('command');
    expect(bare.spec.containers[0]).not.toHaveProperty('args');

    const full = buildScannerPodManifest({
      ...minimal,
      imagePullSecrets: ['regcred'],
      command: ['/usr/local/bin/cybedefend-scanner'],
      args: ['run', 'opengrep', '--scan-run'],
      activeDeadlineSeconds: 7200,
    });
    expect(full.spec.imagePullSecrets).toStrictEqual([{ name: 'regcred' }]);
    expect(full.spec.activeDeadlineSeconds).toBe(7200);
    expect(full.spec.containers[0].command).toStrictEqual([
      '/usr/local/bin/cybedefend-scanner',
    ]);
    expect(full.spec.containers[0].args).toStrictEqual([
      'run',
      'opengrep',
      '--scan-run',
    ]);
  });

  it('without the new inputs, builds the exact manifest it always built', () => {
    expect(
      buildScannerPodManifest({
        ...minimal,
        emptyDirs: [{ name: 'temp-storage', mountPath: '/scan-data' }],
      }),
    ).toStrictEqual({
      metadata: { name: minimal.name, labels: minimal.labels },
      spec: {
        automountServiceAccountToken: false,
        securityContext: { seccompProfile: { type: 'RuntimeDefault' } },
        volumes: [{ name: 'temp-storage', emptyDir: {} }],
        containers: [
          {
            name: 'scanner',
            image: minimal.image,
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
            },
            volumeMounts: [{ mountPath: '/scan-data', name: 'temp-storage' }],
            imagePullPolicy: 'IfNotPresent',
            env: minimal.env,
            resources: minimal.resources,
          },
        ],
        restartPolicy: 'Never',
      },
    });
  });

  it('empty lists of the new inputs change nothing', () => {
    expect(
      buildScannerPodManifest({
        ...minimal,
        projectedTokens: [],
        secretItemVolumes: [],
      }),
    ).toStrictEqual(buildScannerPodManifest(minimal));
  });

  it('sets the service account, a projected token and a secret with only its listed item, all read-only', () => {
    const pod = buildScannerPodManifest({
      ...minimal,
      emptyDirs: [{ name: 'temp-storage', mountPath: '/scan-data' }],
      serviceAccountName: 'scanner-grpc',
      projectedTokens: [
        {
          volume: 'scanner-auth',
          mountPath: '/var/run/secrets/cybedefend/scanner',
          path: 'token',
          audience: 'cybedefend:scanner:p1:s1',
          expirationSeconds: 600,
        },
      ],
      secretItemVolumes: [
        {
          volume: 'scanner-grpc-ca',
          secretName: 'scanner-grpc-ca',
          key: 'ca.crt',
          path: 'ca.crt',
          mountPath: '/etc/cybedefend/scanner-ca',
        },
      ],
    });
    expect(pod.spec.serviceAccountName).toBe('scanner-grpc');
    expect(pod.spec.automountServiceAccountToken).toBe(false);
    expect(pod.spec.volumes).toStrictEqual([
      { name: 'temp-storage', emptyDir: {} },
      {
        name: 'scanner-auth',
        projected: {
          sources: [
            {
              serviceAccountToken: {
                audience: 'cybedefend:scanner:p1:s1',
                expirationSeconds: 600,
                path: 'token',
              },
            },
          ],
        },
      },
      {
        name: 'scanner-grpc-ca',
        secret: {
          secretName: 'scanner-grpc-ca',
          items: [{ key: 'ca.crt', path: 'ca.crt' }],
        },
      },
    ]);
    expect(pod.spec.containers[0].volumeMounts).toStrictEqual([
      { mountPath: '/scan-data', name: 'temp-storage' },
      {
        mountPath: '/var/run/secrets/cybedefend/scanner',
        name: 'scanner-auth',
        readOnly: true,
      },
      {
        mountPath: '/etc/cybedefend/scanner-ca',
        name: 'scanner-grpc-ca',
        readOnly: true,
      },
    ]);
  });
});
