import { isCommunityEdition } from './edition';
import { EE_PROTO_PATHS } from './ee-modules';

/**
 * The closed proto files the running edition loads in addition to the
 * exported ones, as paths relative to the proto base path (main.ts joins
 * them onto it). Empty in the community edition; filled in the private tree,
 * blanked by the export overlay.
 */
export function editionProtoPaths(): string[] {
  return isCommunityEdition() ? [] : [...EE_PROTO_PATHS];
}
