import { EE_PROTO_PATHS } from './ee-modules';
import { isCommunityEdition } from './edition';

/**
 * The server protos every edition loads: the core ones. The Community Edition
 * adds none (the closed services do not exist there); the cloud appends
 * EE_PROTO_PATHS.
 */
export const CORE_SERVER_PROTOS: string[] = [
  'global-management/global_management.proto',
  // Loaded in every edition; in the cloud no handler binds it, so
  // every LocalAuthService call answers UNIMPLEMENTED.
  'global-management/local_auth.proto',
  'health/health.proto',
];

export function editionServerProtos(): string[] {
  return isCommunityEdition()
    ? [...CORE_SERVER_PROTOS]
    : [...CORE_SERVER_PROTOS, ...EE_PROTO_PATHS];
}
