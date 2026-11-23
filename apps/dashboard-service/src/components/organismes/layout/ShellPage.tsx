import React, { ReactNode } from 'react';
import ProtectedRouteWrapper from '@/components/molecules/protected-route/ProtectedRouteWrapper';
import Layout from './Layout';

interface ShellPageProps {
  /** Passed to the shell's header. */
  currentPath: string;
  /** Wait for the session and the organization before rendering the page. */
  protect?: boolean;
  children: ReactNode;
}

/**
 * The element of every route rendered inside the shell.
 *
 * React Router renders a route's element without a key, so React keeps a
 * component mounted from one route to the next only when both elements have
 * the same type at the same place. With some pages wrapped `<Layout>` and
 * others `<ProtectedRouteWrapper><Layout>`, every move between the two kinds
 * (home and project page) remounted the whole shell, reopening its streams
 * and reloading its panels. Here the tree is always ShellPage →
 * ProtectedRouteWrapper → Layout, protected or not; a protected page still
 * shows the loader, without the shell, until the app is ready.
 */
const ShellPage: React.FC<ShellPageProps> = ({ currentPath, protect = false, children }) => (
  <ProtectedRouteWrapper enabled={protect}>
    <Layout currentPath={currentPath}>{children}</Layout>
  </ProtectedRouteWrapper>
);

export default ShellPage;
