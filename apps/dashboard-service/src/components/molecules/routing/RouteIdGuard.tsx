import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { isUuid } from '@/utils/uuid';

interface RouteIdGuardProps {
  /** The route parameters that must be UUIDs (`projectId` when not given). */
  params?: readonly string[];
  /** Where an address whose id is not a UUID is sent. */
  fallback: string;
  children: React.ReactNode;
}

const PROJECT_ID: readonly string[] = ['projectId'];

/**
 * Renders a page only when each id parameter of the address is a UUID.
 *
 * The router hands parameters decoded (`..%2Fx` arrives as `../x`, `%09` as a
 * tab) and the pages put them in request paths, so any other value is sent to
 * `fallback`, replacing the entry in the history, before the page runs and
 * before any request.
 */
const RouteIdGuard: React.FC<RouteIdGuardProps> = ({ params = PROJECT_ID, fallback, children }) => {
  const values = useParams();
  const refused = params.some((param) => values[param] !== undefined && !isUuid(values[param]));
  if (refused) return <Navigate to={fallback} replace />;
  return <>{children}</>;
};

export default RouteIdGuard;
