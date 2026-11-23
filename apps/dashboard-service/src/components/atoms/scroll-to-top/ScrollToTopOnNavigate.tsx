import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Resets the window scroll position on every route (pathname) change.
 * SPA navigations keep the previous page's scroll offset, so opening a
 * detail page from a scrolled list landed mid-page. Search-param changes
 * (filters, ?imageId=…) intentionally do not trigger a reset.
 */
const ScrollToTopOnNavigate: React.FC = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [pathname]);

  return null;
};

export default ScrollToTopOnNavigate;
