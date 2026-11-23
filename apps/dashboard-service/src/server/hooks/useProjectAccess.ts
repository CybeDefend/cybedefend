import { useEffect, useState, useRef, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { productHome, useProduct } from '@/utils/product';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { RootState } from '../store';
import { fetchProject } from '../services/projectService';

interface UseProjectAccessResult {
  hasAccess: boolean;
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook to verify if the current user has access to a specific project
 * @param projectId The project ID to check access for
 * @returns Object containing access status, loading state, and error
 */
export const useProjectAccess = (projectId: string | undefined): UseProjectAccessResult => {
  const [hasAccess, setHasAccess] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  const selectedOrganization = useSelector((state: RootState) => state.organization.selectedOrganization);
  const navigate = useNavigate();
  const { t } = useTranslation();
  // A project page exists in both products: without access, the account goes
  // to the home of the product it is in, never the root, whose landing rule
  // may pick the other one.
  const home = productHome(useProduct());
  
  // Ref to track if we've already shown error and redirected for this projectId
  const hasRedirectedRef = useRef<Set<string>>(new Set());
  
  // Memoize the redirect function to prevent unnecessary re-renders
  const handleNoAccess = useCallback((projectId: string) => {
    if (hasRedirectedRef.current.has(projectId)) {
      return; // Already handled this project
    }
    
    hasRedirectedRef.current.add(projectId);
    toast.error(
      t('errors.projectAccess.noAccess')
    );
    navigate(home, { replace: true });
    setHasAccess(false);
  }, [t, navigate, home]);

  useEffect(() => {
    const checkProjectAccess = async () => {
      if (!projectId || !selectedOrganization?.id) {
        setIsLoading(false);
        setHasAccess(false);
        return;
      }

      // Reset redirect tracking for new project
      if (!hasRedirectedRef.current.has(projectId)) {
        try {
          setIsLoading(true);
          setError(null);

          // Directly fetch the project - if it fails with 403/404, user has no access
          // The backend already handles authorization, so a successful response means user has access
          await fetchProject(projectId);
          setHasAccess(true);
        } catch (err: any) {
          console.error('Error checking project access:', err);
          
          // Check if it's a 403/404 error (no access/not found)
          if (err.response?.status === 403 || err.response?.status === 404 || err.statusCode === 403 || err.statusCode === 404) {
            handleNoAccess(projectId);
          } else {
            // Other error - might be network issue
            setError(
              t('errors.projectAccess.checkFailed')
            );
            setHasAccess(false);
          }
        } finally {
          setIsLoading(false);
        }
      }
    };

    checkProjectAccess();
  }, [projectId, selectedOrganization?.id, handleNoAccess, t]);

  // Clean up redirect tracking when component unmounts or projectId changes
  useEffect(() => {
    return () => {
      if (projectId) {
        hasRedirectedRef.current.delete(projectId);
      }
    };
  }, [projectId]);

  return { hasAccess, isLoading, error };
};

export default useProjectAccess;
