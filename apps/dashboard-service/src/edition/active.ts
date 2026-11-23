import type { RouteObject } from 'react-router-dom';
import { COMMUNITY_SLOTS } from './community-slots';
import { eeAuthClient, eeExtensions, eeRoutes, eeSlots } from './ee-entry';
import { EDITION, type Edition } from './edition';
import { EMPTY_EXTENSIONS, type EeExtensions } from './extensions';
import type { AuthClient } from './auth/authClient';
import type { SlotRegistration } from './slots';

/** What `Slot` renders: the community slots in a community build, the ee slots otherwise. */
export function activeSlots(edition: Edition = EDITION): SlotRegistration[] {
  return edition === 'community' ? COMMUNITY_SLOTS : eeSlots;
}

export function activeEeRoutes(edition: Edition = EDITION): RouteObject[] {
  return edition === 'community' ? [] : eeRoutes;
}

export function activeEeAuthClient(edition: Edition = EDITION): AuthClient | null {
  return edition === 'community' ? null : eeAuthClient;
}

/** The extensions of the active edition: EMPTY_EXTENSIONS in community, the ee ones otherwise. */
export function activeExtensions(edition: Edition = EDITION): EeExtensions {
  return edition === 'community' ? EMPTY_EXTENSIONS : eeExtensions;
}

export const ACTIVE_EE_ROUTES: RouteObject[] = activeEeRoutes(EDITION);
export const ACTIVE_EE_SLOTS: SlotRegistration[] = EDITION === 'community' ? [] : eeSlots;
export const ACTIVE_EE_AUTH_CLIENT: AuthClient | null = activeEeAuthClient(EDITION);
export const ACTIVE_SLOTS: SlotRegistration[] = activeSlots(EDITION);
export const ACTIVE_EXTENSIONS: EeExtensions = activeExtensions(EDITION);
