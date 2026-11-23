import { ident, jsonRemoveKey } from '@cybedefend/db-dialect';

/**
 * How long a scan keeps its registry credentials.
 *
 * A container scan of a private registry that waits in the queue keeps its
 * credentials, encrypted (`registry-auth-crypto.ts`), in
 * `scan.metadata.registryAuth`: the dequeue reads them once to launch the
 * scan's pods. Nothing reads them after that. Each image scanner pod holds its
 * own registry Secret, and a stuck-pod recreation reads that Secret back. So
 * the credentials stay on the row only while the scan is `queued`, and the
 * write that moves the scan out of the queue removes them.
 */

/** Where the credentials sit in `scan.metadata`. */
export const REGISTRY_AUTH_JSON_PATH = '$.registryAuth';

/**
 * The value of `metadata` that removes them, inside the same UPDATE:
 * `JSON_REMOVE` on MySQL, the `-` operator on PostgreSQL's jsonb. On
 * MySQL the rendered text is byte-identical to the former literal.
 */
export const REMOVE_REGISTRY_AUTH_SQL = jsonRemoveKey(
  ident('metadata'),
  'registryAuth',
).text;

/** True for a state move that takes a scan out of the queue. */
export function leavesTheQueue(
  fromStates: readonly string[],
  toState: string,
): boolean {
  return toState !== 'queued' && fromStates.includes('queued');
}

/**
 * `metadata` without the credentials. The same object when it holds none, so
 * a later `save` sees no change to write.
 */
export function withoutRegistryAuth<
  T extends Record<string, unknown> | null | undefined,
>(metadata: T): T {
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    !Object.prototype.hasOwnProperty.call(metadata, 'registryAuth')
  ) {
    return metadata;
  }
  const rest: Record<string, unknown> = { ...metadata };
  delete rest.registryAuth;
  return rest as T;
}
