import React from 'react';
import RouteIdGuard from './RouteIdGuard';

interface ProjectIdGuardProps {
  /** Where a project id that is not a UUID is sent. */
  fallback: string;
  children: React.ReactNode;
}

/**
 * Renders a project page only when the `:projectId` of the address is a UUID
 * (`RouteIdGuard` on `projectId`): the pages put it in request paths.
 */
const ProjectIdGuard: React.FC<ProjectIdGuardProps> = ({ fallback, children }) => (
  <RouteIdGuard params={['projectId']} fallback={fallback}>
    {children}
  </RouteIdGuard>
);

export default ProjectIdGuard;
