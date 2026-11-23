import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../store";
import { setVersionLoading, setVersionInfo } from "../store/appVersionSlice";
import { fetchAppVersion } from "../services/appVersionService";

/**
 * Loads the application's version information once, when the application
 * starts.
 */
export const useAppVersion = () => {
  const dispatch = useDispatch();
  const { versionInfo, isLoading, isLoaded } = useSelector(
    (state: RootState) => state.appVersion
  );

  useEffect(() => {
    // Load only once, and avoid concurrent calls
    if (!isLoaded && !isLoading) {
      dispatch(setVersionLoading());
      fetchAppVersion().then((info) => {
        dispatch(setVersionInfo(info));
      });
    }
  }, [isLoaded, isLoading, dispatch]);

  return versionInfo;
};
