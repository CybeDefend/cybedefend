import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

interface BreadcrumbProjectValue {
  projectName: string | null;
  setProjectName: (name: string | null) => void;
}

const BreadcrumbProjectContext = createContext<BreadcrumbProjectValue>({
  projectName: null,
  setProjectName: () => undefined,
});

/**
 * Carries the current project's name to the breadcrumb.
 *
 * The breadcrumb only sees the URL, and a project URL reads
 * `/appsec/project/<uuid>/...` (or a closed space's `/<prefix>/project/<uuid>/...`) — so the
 * first crumb said "Project", the same word on
 * every project in the account. It could not tell the user where they were,
 * which is the crumb's entire job. Pages that already load the project publish
 * the name here; the breadcrumb falls back to the generic label when nothing
 * has been published yet (first paint, or a route that never loads a project).
 */
export const BreadcrumbProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [projectName, setProjectName] = useState<string | null>(null);
  const value = useMemo(() => ({ projectName, setProjectName }), [projectName]);

  return (
    <BreadcrumbProjectContext.Provider value={value}>{children}</BreadcrumbProjectContext.Provider>
  );
};

/** Read the published name. Returns null when none is known. */
export const useBreadcrumbProjectName = (): string | null =>
  useContext(BreadcrumbProjectContext).projectName;

/**
 * Publish the project name for as long as the calling component is mounted.
 * Clearing on unmount matters: leaving a project must not leave its name
 * behind on the next screen.
 */
export const usePublishProjectName = (name: string | null | undefined): void => {
  const { setProjectName } = useContext(BreadcrumbProjectContext);

  useEffect(() => {
    if (!name) return undefined;
    setProjectName(name);
    return () => setProjectName(null);
  }, [name, setProjectName]);
};

export default BreadcrumbProjectContext;
