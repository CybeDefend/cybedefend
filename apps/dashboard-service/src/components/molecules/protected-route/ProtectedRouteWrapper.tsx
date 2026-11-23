import React from 'react';
import { useSelector } from 'react-redux';
import LoaderHome from '../../atoms/loader/LoaderHome';
import { RootState } from '@/server/store';

interface ProtectedRouteWrapperProps {
  children: React.ReactNode;
  /**
   * False renders the children at once. ShellPage renders every page of the
   * shell through this wrapper, protected or not, so the <Layout> below it
   * sits at the same place from one route to the next and stays mounted.
   */
  enabled?: boolean;
}

/**
 * ProtectedRouteWrapper ensures that child components only render when:
 * 1. User is authenticated
 * 2. App initialization is complete
 * 3. Data (profile, organization) is stable
 * 
 * This prevents child components from triggering API calls with incomplete/changing dependencies.
 * It's specifically designed to solve the cascade rendering issue that caused multiple API calls
 * in ResultsSastPage, ResultsScaPage, and ResultsIacPage.
 */
const ProtectedRouteWrapper: React.FC<ProtectedRouteWrapperProps> = ({ children, enabled = true }) => {
  const isAuthenticated = useSelector((state: RootState) => state.auth.isAuthenticated);
  const appState = useSelector((state: RootState) => state.app);
  const selectedOrganization = useSelector((state: RootState) => state.organization.selectedOrganization);

  // Don't render children until everything is ready
  const isReady = isAuthenticated &&
    appState.isAppInitialized &&
    appState.isDataStable &&
    selectedOrganization;

  if (enabled && !isReady) {
    return <LoaderHome />;
  }

  return <>{children}</>;
};

export default ProtectedRouteWrapper;
