import { currentEdition } from './edition';
import { EE_PROTO_PATHS } from './ee-modules';

/**
 * The closed protos the service loads (paths relative to libs/protos): none
 * in the Community Edition, EE_PROTO_PATHS otherwise. main.ts starts the gRPC
 * listener only when this list is not empty.
 */
export function editionProtoPaths(): string[] {
  return currentEdition() === 'community' ? [] : [...EE_PROTO_PATHS];
}
