import type {
  V1Container,
  V1EnvVar,
  V1Pod,
  V1PodSecurityContext,
  V1ResourceRequirements,
  V1SecurityContext,
  V1Volume,
  V1VolumeMount,
} from '@kubernetes/client-node';

/** A projected service account token, mounted read-only. */
export interface ScannerPodProjectedToken {
  volume: string;
  mountPath: string;
  /** The file name under mountPath. */
  path: string;
  audience: string;
  expirationSeconds: number;
}

/** One key of a Secret of the pod's namespace, mounted read-only; the other keys stay out. */
export interface ScannerPodSecretItemVolume {
  volume: string;
  secretName: string;
  key: string;
  /** The file name under mountPath. */
  path: string;
  mountPath: string;
}

export interface ScannerPodManifestInput {
  name: string;
  labels: Record<string, string>;
  image: string;
  imagePullPolicy: 'Always' | 'IfNotPresent';
  imagePullSecrets?: string[];
  command?: string[];
  args?: string[];
  env: V1EnvVar[];
  resources: V1ResourceRequirements;
  emptyDirs: { name: string; mountPath: string }[];
  readOnlyRootFilesystem: boolean;
  runAsUser?: number;
  activeDeadlineSeconds?: number;
  /** The pod's service account. Its API token is still never mounted. */
  serviceAccountName?: string;
  projectedTokens?: ScannerPodProjectedToken[];
  secretItemVolumes?: ScannerPodSecretItemVolume[];
}

/**
 * The manifest of one scanner pod (one container named `scanner`), shared by
 * the cloud's KubernetesService and the Community engine.
 *
 * Every pod is hardened (defense in depth): the scanner pods receive
 * user-uploaded code, so they never mount a service account token (no
 * in-cluster API access), RuntimeDefault seccomp blocks the ~300 dangerous
 * syscalls (ptrace, mount, …), the container drops ALL Linux capabilities and
 * cannot escalate privileges, and the pod never restarts.
 *
 * A service account, projected tokens and secret items are added only when
 * given: without them the manifest is exactly the one it always was. A
 * projected token is a token the pod may present for one audience; the
 * service account's API token stays unmounted.
 *
 * `runAsUser` unset leaves runAsUser/runAsNonRoot/runAsGroup/fsGroup unset:
 * scanner images that run as root (HOME=/root, ~/.cache/<tool> writable).
 * `readOnlyRootFilesystem: false` leaves the key out (those images
 * write to /tmp, /.cache and other rootfs paths at runtime).
 */
export function buildScannerPodManifest(input: ScannerPodManifestInput): V1Pod {
  const podSecurityContext: V1PodSecurityContext = {
    seccompProfile: { type: 'RuntimeDefault' },
    ...(input.runAsUser !== undefined && {
      runAsNonRoot: true,
      runAsUser: input.runAsUser,
      runAsGroup: input.runAsUser,
      fsGroup: input.runAsUser,
    }),
  };
  const containerSecurityContext: V1SecurityContext = {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ['ALL'] },
    ...(input.readOnlyRootFilesystem && { readOnlyRootFilesystem: true }),
  };
  const tokens = input.projectedTokens ?? [];
  const secrets = input.secretItemVolumes ?? [];
  const volumes: V1Volume[] = [
    ...input.emptyDirs.map(({ name }) => ({ name, emptyDir: {} })),
    ...tokens.map((token) => ({
      name: token.volume,
      projected: {
        sources: [
          {
            serviceAccountToken: {
              audience: token.audience,
              expirationSeconds: token.expirationSeconds,
              path: token.path,
            },
          },
        ],
      },
    })),
    ...secrets.map((secret) => ({
      name: secret.volume,
      secret: {
        secretName: secret.secretName,
        items: [{ key: secret.key, path: secret.path }],
      },
    })),
  ];
  const volumeMounts: V1VolumeMount[] = [
    ...input.emptyDirs.map(({ name, mountPath }) => ({ mountPath, name })),
    ...[...tokens, ...secrets].map(({ volume, mountPath }) => ({
      mountPath,
      name: volume,
      readOnly: true,
    })),
  ];
  const container: V1Container = {
    name: 'scanner',
    image: input.image,
    ...(input.command && { command: input.command }),
    ...(input.args && { args: input.args }),
    securityContext: containerSecurityContext,
    volumeMounts,
    imagePullPolicy: input.imagePullPolicy,
    env: input.env,
    resources: input.resources,
  };
  return {
    metadata: { name: input.name, labels: input.labels },
    spec: {
      ...(input.imagePullSecrets && {
        imagePullSecrets: input.imagePullSecrets.map((name) => ({ name })),
      }),
      ...(input.serviceAccountName && {
        serviceAccountName: input.serviceAccountName,
      }),
      automountServiceAccountToken: false,
      securityContext: podSecurityContext,
      volumes,
      containers: [container],
      restartPolicy: 'Never',
      ...(input.activeDeadlineSeconds !== undefined && {
        activeDeadlineSeconds: input.activeDeadlineSeconds,
      }),
    },
  };
}
