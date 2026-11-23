import React from 'react';
import { useLandingRedirect } from '@/server/hooks/useLandingRedirect';

/**
 * The root `/`. It is no page of either product: each time it is rendered,
 * once the profile is loaded, it sends the account to the home of its
 * preferred product (`useLandingRedirect`, rule in `utils/landing.ts`). It
 * shows nothing meanwhile; a signed-out visitor is sent to the login page by
 * the application.
 */
const RootLanding: React.FC = () => {
  useLandingRedirect();
  return null;
};

export default RootLanding;
