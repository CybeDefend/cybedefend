import { ForbiddenException } from '@nestjs/common';

/**
 * The core product seam. The core serves `appsec` only; the closed side
 * registers its products at instantiation time (a factory provider of a
 * closed module), which appends the key to `PRODUCT_KEYS` — one array
 * object for the process, because `@IsIn(PRODUCT_KEYS)` keeps its reference —
 * and the policy the core routes read.
 */

export type PermissionChecker = {
  checkPermission(
    resourceId: string,
    resourceType: string,
    permission: string,
    subjectId: string,
  ): Promise<boolean>;
};

/**
 * What a product means for a scan start.
 * `createScanFields`: extra CreateScanRequest fields, spread as is; the core
 * names none of them (kept out of the gateway core for hygiene; scan.proto
 * still has them).
 */
export interface ProductPolicy {
  startScanPermission: string;
  graphOnly: boolean;
  createScanFields?: Readonly<Record<string, unknown>>;
}

/**
 * `scan` is the generated ScanResponse; typed `object` because the exported
 * ScanResponse has none of the closed fields a policy reads.
 */
export interface ScanKindPolicy {
  owns(scan: object): boolean;
  readPermission: string;
}

/** The products this instance serves. Starts as `['appsec']`. */
export const PRODUCT_KEYS: string[] = ['appsec'];

const productPolicies = new Map<string, ProductPolicy>([
  ['appsec', { startScanPermission: 'start_scan', graphOnly: false }],
]);

let scanKindPolicies: ScanKindPolicy[] = [];

/** Idempotent: an already-registered key is left as is; the key is appended once. */
export function registerProduct(key: string, policy: ProductPolicy): void {
  if (productPolicies.has(key)) return;
  productPolicies.set(key, policy);
  PRODUCT_KEYS.push(key);
}

export function registerScanKindPolicy(policy: ScanKindPolicy): void {
  if (scanKindPolicies.some((p) => p.readPermission === policy.readPermission))
    return;
  scanKindPolicies.push(policy);
}

/** Unknown or absent product: the full scan, `start_scan`. */
export function startScanPermission(product?: string): string {
  return (
    productPolicies.get(product ?? '')?.startScanPermission ?? 'start_scan'
  );
}

/** Unknown or absent product: not graph-only. */
export function isGraphOnlyProduct(product?: string): boolean {
  return productPolicies.get(product ?? '')?.graphOnly ?? false;
}

/** Unknown or absent product: no extra CreateScanRequest fields. */
export function productCreateScanFields(
  product?: string,
): Readonly<Record<string, unknown>> {
  return productPolicies.get(product ?? '')?.createScanFields ?? {};
}

/** First owning policy wins; a scan no policy owns is read with `read_scan_result`. */
export function scanReadPermission(scan: object): string {
  return (
    scanKindPolicies.find((p) => p.owns(scan))?.readPermission ??
    'read_scan_result'
  );
}

/**
 * A repository link starts the repository's first scan (external-integrations
 * `linkProject`): the permission of the scan it starts, which the body's
 * product chooses. Its static guard (`manage_integration` + `update`) is
 * product-blind (`writable_any`), so the link also needs this check — without
 * it an organisation whose AppSec plan is unpaid could start an AppSec scan.
 */
export async function assertLinkScanPermission(
  permissions: PermissionChecker,
  req: { user?: { sub?: string } },
  projectId: string,
  product: string | undefined,
): Promise<void> {
  const userId = req?.user?.sub;
  if (!userId) {
    throw new ForbiddenException('Permission denied');
  }
  const allowed = await permissions.checkPermission(
    projectId,
    'project',
    startScanPermission(product),
    userId,
  );
  if (!allowed) {
    throw new ForbiddenException('Permission denied');
  }
}

/** PRODUCT_KEYS back to `['appsec']` (same array object), policies cleared. */
export function resetProductRegistryForTests(): void {
  PRODUCT_KEYS.length = 0;
  PRODUCT_KEYS.push('appsec');
  productPolicies.clear();
  productPolicies.set('appsec', {
    startScanPermission: 'start_scan',
    graphOnly: false,
  });
  scanKindPolicies = [];
}
