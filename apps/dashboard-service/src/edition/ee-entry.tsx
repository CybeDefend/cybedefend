import type { RouteObject } from 'react-router-dom';
import type { AuthClient } from './auth/authClient';
import { EMPTY_EXTENSIONS, type EeExtensions } from './extensions';
import type { SlotRegistration } from './slots';
export type EeProductId = never;
export const eeAuthClient: AuthClient | null = null;
export const eeExtensions: EeExtensions = EMPTY_EXTENSIONS;
export const eeRoutes: RouteObject[] = [];
export const eeSlots: SlotRegistration[] = [];
