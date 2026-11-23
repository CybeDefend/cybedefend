import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

/**
 * History-aware back navigation. React-router stamps an `idx` into
 * `window.history.state` for every in-app entry; idx 0 means the current
 * page is the first in-app entry (deep link, new tab, external referrer).
 * In that case `navigate(-1)` would leave the app or do nothing, so we
 * route to the hierarchical fallback instead.
 */
export const useSmartBack = (fallbackTo: string): (() => void) => {
  const navigate = useNavigate();

  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === "number" && idx > 0) {
      navigate(-1);
    } else {
      navigate(fallbackTo, { replace: true });
    }
  }, [navigate, fallbackTo]);
};

export default useSmartBack;
