import { EE_PROTO_PATHS } from './ee-modules';
import { isCommunityEdition } from './edition';

/**
 * The closed protos the server loads, relative to libs/protos. main.ts
 * builds its protoPath as [...CORE_GRPC_PROTO_PATHS, ...editionProtoPaths()]:
 * community loads only the core protos, cloud adds EE_PROTO_PATHS. The
 * edition is read at each call, so a boot spec sets CYBEDEFEND_EDITION
 * before importing main's modules.
 */
export function editionProtoPaths(): string[] {
  return isCommunityEdition() ? [] : [...EE_PROTO_PATHS];
}
