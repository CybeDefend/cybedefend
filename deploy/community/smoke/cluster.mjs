// CybeDefend Community Edition: the kind side of the smoke's cluster variant.
//
// The pure helpers (manifests, kubeconfig, expected findings, verdicts, the
// archive) are tested by tests/cluster.test.mjs. `KindCluster` drives docker,
// kind and kubectl: the cluster, its namespace, ServiceAccount, Role and
// token, the kubeconfig the instance mounts, the images the pods pull, and the
// docker network the front and the storage join so that the pods reach them.
//
// Every docker resource it creates carries the label cybe-cluster-smoke=1;
// the kind node carries kind's own io.x-k8s.kind.cluster=<name>.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOY_DIR = resolve(HERE, '..');

export const CLUSTER_NAMESPACE = 'cd-scans';
export const CLUSTER_SMOKE_LABEL = 'cybe-cluster-smoke=1';
export const CLUSTER_NAME = 'cd-smoke';
export const KIND_NETWORK = 'cd-smoke-kind';
export const KIND_SUBNET = '172.30.250.0/24';
export const SERVICE_ACCOUNT = 'cybedefend-scanner';
export const SCAN_ADAPTERS = Object.freeze(['opengrep', 'zizmor', 'gitleaks', 'trivy-config', 'trivy-fs']);
export const IMAGE_REGISTRY = 'ghcr.io/cybedefend';
/** The tag of the failure path's image: built from the runner before --scan-run existed. */
export const NO_SCAN_RUN_TAG = '0.0.0-noscanrun';
/** The scanners repository's commit just before the --scan-run mode. */
export const NO_SCAN_RUN_COMMIT = '83fef6f';
const README_NAMESPACE = 'cybedefend-scans';
const NAMESPACE_RE = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

// ─── The README's manifests ────────────────────────────────────────────────

function readme() {
  return readFileSync(join(DEPLOY_DIR, 'README.md'), 'utf8');
}

/** The fenced YAML blocks of the README section « Run scans on a Kubernetes cluster ». */
function clusterYamlBlocks(text = readme()) {
  const start = text.indexOf('\n## Run scans on a Kubernetes cluster\n');
  if (start < 0) throw new Error('README.md has no « Run scans on a Kubernetes cluster » section');
  const rest = text.slice(start + 1);
  const next = rest.indexOf('\n## ', 3);
  const section = next < 0 ? rest : rest.slice(0, next);
  return [...section.matchAll(/^```yaml\n([\s\S]*?)^```$/gm)].map((m) => m[1]);
}

function checkNamespace(namespace) {
  if (!NAMESPACE_RE.test(String(namespace))) throw new Error(`namespace ${JSON.stringify(namespace)} is not a DNS label`);
}

/**
 * The README's `cybedefend-scanner.yaml` (ServiceAccount, Role, RoleBinding,
 * token Secret), with its namespace replaced: the smoke applies what the
 * README tells an administrator to apply.
 */
export function scannerManifests(namespace, readmeText) {
  checkNamespace(namespace);
  const block = clusterYamlBlocks(readmeText).find((b) => /^kind: ServiceAccount$/m.test(b));
  if (!block) throw new Error('the README has no ServiceAccount manifest');
  return block.replaceAll(README_NAMESPACE, namespace);
}

/**
 * The README's `cybedefend-namespace.yaml`, in `namespace`: its label makes
 * Kubernetes enforce the restricted Pod Security Standard, so the kind run
 * proves the scan pods are admitted under it.
 */
export function namespaceManifest(namespace, readmeText) {
  checkNamespace(namespace);
  const block = clusterYamlBlocks(readmeText).find((b) => /^kind: Namespace$/m.test(b));
  if (!block) throw new Error('the README has no Namespace manifest');
  return block.replaceAll(README_NAMESPACE, namespace);
}

/**
 * The instance id the engine labels its pods and Secrets with
 * (`cybedefend.io/instance`): the first 16 hex characters of the SHA-256 of
 * the public URL, trimmed, without a trailing slash, scheme and host in lower
 * case (the README, « When a scanner fails »).
 */
export function instanceId(publicUrl) {
  let url = String(publicUrl ?? '').trim().replace(/\/+$/, '');
  const m = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/.exec(url);
  if (m) url = `${m[1].toLowerCase()}${m[2].toLowerCase()}${m[3]}`;
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/** The README's cleanup selector: this instance's managed pods and Secrets. */
export function managedSelector(id) {
  if (!/^[0-9a-f]{16}$/.test(String(id))) throw new Error(`instance id ${JSON.stringify(id)} is not 16 hex characters`);
  return `app.kubernetes.io/managed-by=cybedefend,cybedefend.io/instance=${id}`;
}

/**
 * `kubectl get pods,secrets -l app.kubernetes.io/managed-by=cybedefend
 * --show-labels`: the server-side tables (no Secret data), one per kind, the
 * labels in the last column. Every managed resource must carry
 * `cybedefend.io/instance=<id>`; the verdict names those that do not.
 */
export function instanceLabelVerdict(table, id) {
  const missing = [];
  let pods = 0;
  let secrets = 0;
  for (const line of String(table ?? '').split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 2 || cols[0] === 'NAME') continue;
    const [name] = cols;
    if (name.startsWith('pod/')) pods += 1;
    else if (name.startsWith('secret/')) secrets += 1;
    else continue;
    const labels = cols[cols.length - 1] === '<none>' ? [] : cols[cols.length - 1].split(',');
    if (!labels.includes(`cybedefend.io/instance=${id}`)) missing.push(name);
  }
  return { ok: missing.length === 0, pods, secrets, missing };
}

/** The Role document of those manifests. */
export function roleManifest(namespace, readmeText) {
  const doc = scannerManifests(namespace, readmeText)
    .split(/^---$/m)
    .find((d) => /^kind: Role$/m.test(d));
  if (!doc) throw new Error('the README manifests have no Role');
  return `${doc.trim()}\n`;
}

/**
 * The README's kubeconfig for the ServiceAccount, its placeholders filled in,
 * plus the namespace on the context.
 */
export function kubeconfigFor(sa, server, token, caData, readmeText) {
  checkNamespace(sa?.namespace);
  for (const [name, value, re] of [
    ['service account name', sa?.name, /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/],
    ['server', server, /^https:\/\/[^\s"'#]+$/],
    ['token', token, /^[A-Za-z0-9._-]+$/],
    ['CA data', caData, /^[A-Za-z0-9+/=]+$/],
  ]) {
    if (typeof value !== 'string' || !re.test(value)) throw new Error(`kubeconfigFor: the ${name} is not a single safe value`);
  }
  const block = clusterYamlBlocks(readmeText).find((b) => /^kind: Config$/m.test(b));
  if (!block) throw new Error('the README has no kubeconfig');
  return block
    .replace('<the address of the API server>', server)
    .replace('<the base64 CA certificate>', caData)
    .replace('<the token of the ServiceAccount>', token)
    .replaceAll(SERVICE_ACCOUNT, sa.name)
    .replace(/^( {6}cluster: .*)$/m, `$1\n      namespace: ${sa.namespace}`);
}

// ─── What the scans must produce ───────────────────────────────────────────

/**
 * One project per scanner type, each with one toggle on (zizmor runs under the
 * SAST toggle, so the cicd project is a second SAST project): the results page
 * to read, the tool that must have produced it, and a string a listed finding
 * of that page must hold.
 */
export function expectedFindings() {
  return [
    { project: 'sast', toggle: 'sastEnabled', page: 'sast', tool: 'opengrep', marker: 'app.py' },
    { project: 'cicd', toggle: 'sastEnabled', page: 'cicd', tool: 'zizmor', marker: 'ci.yml' },
    { project: 'secret', toggle: 'secretEnabled', page: 'secret', tool: 'gitleaks', marker: 'config.py' },
    { project: 'iac', toggle: 'iacEnabled', page: 'iac', tool: 'trivy-config', marker: 'Dockerfile' },
    { project: 'sca', toggle: 'scaEnabled', page: 'sca', tool: 'trivy-fs', marker: 'django' },
  ];
}

const TOGGLES = ['sastEnabled', 'scaEnabled', 'iacEnabled', 'secretEnabled', 'containerEnabled', 'aibomEnabled', 'dastEnabled', 'apiEnabled'];

/** The PATCH /project/:id body the settings page sends, with only `enabled` on. */
export function projectToggles(enabled) {
  if (!TOGGLES.includes(enabled)) throw new Error(`unknown scan toggle ${enabled}`);
  return Object.fromEntries(TOGGLES.map((t) => [t, t === enabled]));
}

/** A results page (`{ total, vulnerabilities }`) lists a finding naming `marker`. */
export function pageListsFinding(body, marker) {
  const rows = Array.isArray(body?.vulnerabilities) ? body.vulnerabilities : [];
  if (!(Number(body?.total) >= 1) || rows.length === 0) return { ok: false, reason: `total is ${body?.total}, no finding listed` };
  if (!rows.some((row) => JSON.stringify(row).includes(marker))) return { ok: false, reason: `no listed finding names ${marker}` };
  return { ok: true };
}

/**
 * `samples`: snapshots of { scanId: state } taken while the scans run. Never
 * more than `max` running at once, and at least one scan seen `queued`.
 */
export function queueVerdict(samples, max) {
  let maxRunning = 0;
  const queued = new Set();
  for (const sample of samples) {
    const states = Object.entries(sample);
    maxRunning = Math.max(maxRunning, states.filter(([, s]) => s === 'running').length);
    for (const [id, s] of states) if (s === 'queued') queued.add(id);
  }
  if (maxRunning > max) return { ok: false, maxRunning, queued: [...queued], reason: `${maxRunning} scans ran at once, the limit is ${max}` };
  if (queued.size === 0) return { ok: false, maxRunning, queued: [], reason: 'no scan was seen queued' };
  return { ok: true, maxRunning, queued: [...queued] };
}

const KUBECONFIG_SECRET_KEYS = ['token', 'certificate-authority-data', 'client-certificate-data', 'client-key-data', 'password'];

/** The credential values of a kubeconfig: the token, the CA, a client key or certificate, a password. */
export function kubeconfigSecrets(kubeconfig) {
  return String(kubeconfig ?? '')
    .split(/\r?\n/)
    .map((l) => /^\s*(?:- )?([A-Za-z-]+):\s*(\S.*)$/.exec(l))
    .filter((m) => m && KUBECONFIG_SECRET_KEYS.includes(m[1]))
    .map((m) => m[2].trim().replace(/^"(.*)"$/, '$1'))
    .filter((v) => v.length >= 8);
}

/**
 * The log lines that hold an upload token, a signed URL's signature, or a
 * credential value of the kubeconfig. Its other values (the server address,
 * the ServiceAccount name) are not secrets and may be logged.
 *
 * X-Amz-Signature is checked in every container: no log writes a signed
 * query by design. The front's nginx drops every query string from its
 * access log (nginx/nginx.conf, $cd_log_uri); the storage relay is a stream
 * proxy with no access log (storage/nginx.conf); SeaweedFS runs at its
 * default verbosity, which writes no request line.
 */
export function leakedLines(logs, kubeconfig) {
  const values = kubeconfigSecrets(kubeconfig);
  return String(logs ?? '')
    .split(/\r?\n/)
    .filter((line) => /\bcdst_/.test(line) || /X-Amz-Signature/i.test(line) || values.some((v) => line.includes(v)));
}

/** `logs` with every line leakedLines would report replaced, before it is printed. */
export function withholdLeaks(logs, kubeconfig) {
  const leaked = new Set(leakedLines(logs, kubeconfig));
  return String(logs ?? '')
    .split(/\r?\n/)
    .map((line) => (leaked.has(line) ? '[a line holding a credential is withheld]' : line))
    .join('\n');
}

/** A leak check must read something: `compose logs` that failed answers an empty string. */
export function logSnapshotVerdict(logs) {
  if (typeof logs !== 'string') return { ok: false, reason: 'no snapshot was taken' };
  if (logs.length === 0) return { ok: false, reason: 'the snapshot is empty: compose logs read nothing' };
  return { ok: true };
}

/** Exactly one scan-end dispatch per scan, read once the settle period has passed. */
export function settledDispatchVerdict(counts) {
  const wrong = Object.entries(counts)
    .filter(([, n]) => n !== 1)
    .map(([id, n]) => `${id}: ${n}`);
  return { ok: wrong.length === 0, wrong };
}

/**
 * What a run tears down: only what it created, in order (the stack first,
 * which holds containers on the network, then the kubeconfig it wrote, the
 * cluster, and the network last). `--keep` keeps everything.
 */
export function teardownPlan({ keep, createdNetwork, createdCluster, stackStarted, wroteKubeconfig }) {
  if (keep) return [];
  return [
    stackStarted && 'stack',
    wroteKubeconfig && 'kubeconfig',
    createdCluster && 'cluster',
    createdNetwork && 'network',
  ].filter(Boolean);
}

/** `docker network inspect -f '{{index .Labels "cybe-cluster-smoke"}}'` answers 1 for a network of the smoke. */
export function networkIsOurs(labelValue) {
  return String(labelValue ?? '').trim() === '1';
}

/** The CLUSTER_SCANNING_ENABLED lines for `namespace`. */
export function enabledLogCount(logs, namespace) {
  const re = new RegExp(`CLUSTER_SCANNING_ENABLED namespace=${namespace}(\\s|$)`);
  return String(logs ?? '')
    .split(/\r?\n/)
    .filter((l) => re.test(l)).length;
}

/** The `instance=<id>` of each CLUSTER_SCANNING_ENABLED line for `namespace`, null when a line has none. */
export function enabledInstanceIds(logs, namespace) {
  const re = new RegExp(`CLUSTER_SCANNING_ENABLED namespace=${namespace}(?:\\s|$)`);
  return String(logs ?? '')
    .split(/\r?\n/)
    .filter((l) => re.test(l))
    .map((l) => /\binstance=([0-9a-f]+)\b/.exec(l)?.[1] ?? null);
}

/** `kind version` prints `kind v0.33.0 go… os/arch`: 0.27 or later. */
export function kindVersionOk(text) {
  const m = /\bv(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ''));
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > 0 || min >= 27;
}

export function missingClusterTools(has) {
  return ['kind', 'kubectl'].filter((tool) => !has(tool));
}

export function scannerImage(adapter, tag) {
  return `${IMAGE_REGISTRY}/cybedefend-scanners/${adapter}:${tag}`;
}

/** Fixed addresses for the front and the storage on a /24 kind network. */
export function clusterAddresses(subnet) {
  const m = /^(\d+\.\d+\.\d+)\.0\/24$/.exec(String(subnet));
  if (!m) throw new Error(`the kind network must be a /24, got ${subnet}`);
  const dashboardIp = `${m[1]}.250`;
  const storageIp = `${m[1]}.251`;
  return { dashboardIp, storageIp, publicUrl: `http://${dashboardIp}:8080`, storagePublicUrl: `http://${storageIp}:9000` };
}

/** What the runner writes into the stack's .env for the cluster variant. */
export function clusterEnvOverrides({ subnet = KIND_SUBNET, network = KIND_NETWORK, tag }) {
  const a = clusterAddresses(subnet);
  return {
    CYBEDEFEND_PUBLIC_URL: a.publicUrl,
    CYBEDEFEND_STORAGE_PUBLIC_URL: a.storagePublicUrl,
    CYBEDEFEND_KIND_NETWORK: network,
    CYBEDEFEND_KIND_DASHBOARD_IP: a.dashboardIp,
    CYBEDEFEND_KIND_STORAGE_IP: a.storageIp,
    CYBEDEFEND_SCANNER_IMAGE_TAG: tag,
  };
}

/**
 * analysis-reporting's line when it dispatches a scan's end (notifications,
 * issues, cyber-risk), once its Redis lock is taken:
 * `[ScanCompleteNotification] All processing complete for scan <id>. Dispatching notifications and creating issues...`
 * (ScanCompleteNotificationService.dispatchScanEnd). The count per scan id.
 */
export function scanEndDispatchCounts(logs, scanIds) {
  const counts = Object.fromEntries(scanIds.map((id) => [id, 0]));
  const re = /\[ScanCompleteNotification\] All processing complete for scan (\S+?)\. Dispatching notifications/;
  for (const line of String(logs ?? '').split(/\r?\n/)) {
    const m = re.exec(line);
    if (m && m[1] in counts) counts[m[1]] += 1;
  }
  return counts;
}

/** `docker info --format '{{.OperatingSystem}}'` names Docker Desktop, whose host cannot reach container addresses. */
export function isDockerDesktop(operatingSystem) {
  return /\bDocker Desktop\b/i.test(String(operatingSystem ?? ''));
}

export const CONTAINER_IP_HOSTS = 'the cluster variant needs a host that can reach container IP addresses: Linux or OrbStack, not Docker Desktop';

/** Every file under `dir`, as { name: posix path relative to dir, content }. */
export function fixtureEntries(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push({ name: relative(dir, full).split(sep).join('/'), content: readFileSync(full) });
    }
  };
  walk(dir);
  return out;
}

/** A ZIP archive of `entries` (deflate, no directory entries, no extra field). */
export function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, content } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = deflateRawSync(content);
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ─── kind, kubectl, docker ─────────────────────────────────────────────────

export class ClusterError extends Error {}

function run(cmd, args, { check = true, input, env } = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', input, env: env ? { ...process.env, ...env } : process.env, maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw new ClusterError(`${cmd} could not be run: ${res.error.message}`);
  if (check && res.status !== 0) {
    throw new ClusterError(`${cmd} ${args.slice(0, 6).join(' ')} … exited ${res.status}: ${(res.stderr || '').trim().slice(-1500)}`);
  }
  return res;
}

export function onPath(tool) {
  return spawnSync(tool, ['version', ...(tool === 'kubectl' ? ['--client'] : [])], { encoding: 'utf8' }).status === 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A kind cluster on a docker network of its own (KIND_EXPERIMENTAL_DOCKER_NETWORK),
 * labelled and with a fixed /24, so that the front and the storage can take
 * fixed addresses on it before the stack starts (a static address needs a
 * user-defined subnet, which kind's own `kind` network has not).
 */
export class KindCluster {
  constructor({ name = CLUSTER_NAME, network = KIND_NETWORK, subnet = KIND_SUBNET, namespace = CLUSTER_NAMESPACE } = {}) {
    this.name = name;
    this.network = network;
    this.subnet = subnet;
    this.namespace = namespace;
    this.dir = mkdtempSync(join(tmpdir(), 'cd-smoke-kind-'));
    this.adminKubeconfig = join(this.dir, 'admin-kubeconfig');
    /** What this run created, and so may delete. */
    this.createdNetwork = false;
    this.createdCluster = false;
    this.wroteKubeconfig = false;
  }

  /** The API server address on the kind network, as `kind get kubeconfig --internal` prints it. */
  get internalServer() {
    return `https://${this.name}-control-plane:6443`;
  }

  kubectl(args, options) {
    return run('kubectl', ['--kubeconfig', this.adminKubeconfig, ...args], options);
  }

  networkExists() {
    return run('docker', ['network', 'inspect', this.network], { check: false }).status === 0;
  }

  async create() {
    if (this.networkExists()) {
      throw new ClusterError(`docker network ${this.network} already exists: remove it (docker network rm ${this.network}) or the cluster of a previous run`);
    }
    const clusters = run('kind', ['get', 'clusters'], { check: false }).stdout.split('\n').map((l) => l.trim());
    if (clusters.includes(this.name)) {
      throw new ClusterError(`a kind cluster ${this.name} already exists (a previous run with --keep?): delete it with kind delete cluster --name ${this.name}`);
    }
    run('docker', ['network', 'create', '--label', CLUSTER_SMOKE_LABEL, '--subnet', this.subnet, '-o', 'com.docker.network.bridge.enable_ip_masquerade=true', this.network]);
    this.createdNetwork = true;
    // Set before the call: a create that fails half-way leaves a node to delete.
    this.createdCluster = true;
    run('kind', ['create', 'cluster', '--name', this.name, '--wait', '180s'], { env: { KIND_EXPERIMENTAL_DOCKER_NETWORK: this.network } });
    writeFileSync(this.adminKubeconfig, run('kind', ['get', 'kubeconfig', '--name', this.name]).stdout, { mode: 0o600 });
  }

  /** The namespace, then the README's ServiceAccount, Role, RoleBinding and token Secret. */
  async applyScannerAccess() {
    this.kubectl(['apply', '-f', '-'], { input: namespaceManifest(this.namespace) });
    this.kubectl(['label', 'namespace', this.namespace, CLUSTER_SMOKE_LABEL]);
    this.kubectl(['apply', '-f', '-'], { input: scannerManifests(this.namespace) });
    const deadline = Date.now() + 60_000;
    for (;;) {
      const secret = (key) =>
        this.kubectl(['-n', this.namespace, 'get', 'secret', `${SERVICE_ACCOUNT}-token`, '-o', `jsonpath={.data.${key}}`], { check: false }).stdout.trim();
      const token = secret('token');
      const ca = secret('ca\\.crt');
      if (token && ca) return { token: Buffer.from(token, 'base64').toString('utf8'), ca };
      if (Date.now() > deadline) throw new ClusterError('the ServiceAccount token was not issued within 60 s');
      await sleep(1000);
    }
  }

  /**
   * Writes the instance's kubeconfig, mode 0600, then gives it to the
   * services' user 10001 as the README does (`chown 10001:10001`), through a
   * labelled throwaway container since the runner has no sudo. Returns its text.
   */
  writeInstanceKubeconfig(path, { token, ca }) {
    const text = kubeconfigFor({ name: SERVICE_ACCOUNT, namespace: this.namespace }, this.internalServer, token, ca);
    writeFileSync(path, text, { mode: 0o600, flag: 'wx' });
    // Written by this run (the exclusive flag refused any existing file): the teardown may remove it.
    this.wroteKubeconfig = true;
    run('docker', [
      'run', '--rm', '--label', CLUSTER_SMOKE_LABEL, '--network', 'none',
      '-v', `${dirname(path)}:/cluster`, 'node:26.12.1-alpine3.24', 'chown', '10001:10001', `/cluster/${basename(path)}`,
    ]);
    return text;
  }

  /** `kubectl auth can-i` as the ServiceAccount, through its own kubeconfig. */
  canI(kubeconfigPath, verb, resource) {
    const res = run('kubectl', ['--kubeconfig', kubeconfigPath, 'auth', 'can-i', verb, resource, '-n', this.namespace], { check: false });
    return res.stdout.trim() === 'yes';
  }

  loadImages(images) {
    if (images.length > 0) run('kind', ['load', 'docker-image', '--name', this.name, ...images]);
  }

  /**
   * Every managed pod and Secret left in the namespace. The cluster is fresh,
   * so all of them come from this run: the broad selector also catches one
   * the instance label is missing from.
   */
  leftovers() {
    return this.kubectl(['get', 'pods,secrets', '-n', this.namespace, '-l', 'app.kubernetes.io/managed-by=cybedefend', '-o', 'name'])
      .stdout.split('\n')
      .filter(Boolean);
  }

  /** The managed pods' and Secrets' names and labels, as a server-side table: never a Secret's data. */
  managedLabels() {
    return this.kubectl(
      ['get', 'pods,secrets', '-n', this.namespace, '-l', 'app.kubernetes.io/managed-by=cybedefend', '--show-labels'],
      { check: false },
    ).stdout;
  }

  delete() {
    run('kind', ['delete', 'cluster', '--name', this.name], { check: false });
  }

  /** Removes the network, once nothing is attached to it any more, and only if it carries the smoke's label. */
  removeNetwork() {
    const label = run('docker', ['network', 'inspect', '-f', '{{index .Labels "cybe-cluster-smoke"}}', this.network], { check: false });
    if (label.status !== 0 || !networkIsOurs(label.stdout)) {
      console.log(`  kept docker network ${this.network}: it does not carry ${CLUSTER_SMOKE_LABEL}`);
      return;
    }
    run('docker', ['network', 'rm', this.network], { check: false });
  }

  /** Deletes the admin kubeconfig's folder (kept with --keep: it reaches the cluster). */
  removeScratch() {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/**
 * Builds the five scanner images from the scanners repository with the
 * Dockerfiles `make images` builds, tagged with the name the pods pull and
 * labelled. `commit` builds from that commit (git archive into a temporary
 * folder) instead of the working tree: the failure path's image.
 */
export function buildScannerImages({ repo, tag, adapters = SCAN_ADAPTERS, commit }) {
  let context = resolve(repo);
  let scratch;
  if (commit) {
    scratch = mkdtempSync(join(tmpdir(), 'cd-smoke-scanners-'));
    const tar = spawnSync('sh', ['-c', `git -C "$1" archive --format=tar "$2" | tar -x -C "$3"`, 'sh', context, commit, scratch], { encoding: 'utf8' });
    if (tar.status !== 0) throw new ClusterError(`git archive ${commit} failed: ${tar.stderr.trim().slice(-500)}`);
    context = scratch;
  }
  try {
    const images = [];
    for (const adapter of adapters) {
      const image = scannerImage(adapter, tag);
      run('docker', ['build', '-f', join(context, 'images', adapter, 'Dockerfile'), '--build-arg', `VERSION=${tag}`, '--label', CLUSTER_SMOKE_LABEL, '-t', image, context]);
      images.push(image);
    }
    return images;
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

/** Whether a local image exists. */
export function hasImage(image) {
  return run('docker', ['image', 'inspect', image], { check: false }).status === 0;
}
