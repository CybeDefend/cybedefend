import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { AppVersionInfo } from "../services/appVersionService";

interface AppVersionState {
  versionInfo: AppVersionInfo | null;
  isLoading: boolean;
  isLoaded: boolean;
}

const initialState: AppVersionState = {
  versionInfo: null,
  isLoading: false,
  isLoaded: false,
};

const appVersionSlice = createSlice({
  name: "appVersion",
  initialState,
  reducers: {
    setVersionLoading: (state) => {
      state.isLoading = true;
    },
    setVersionInfo: (state, action: PayloadAction<AppVersionInfo>) => {
      state.versionInfo = action.payload;
      state.isLoading = false;
      state.isLoaded = true;
    },
  },
});

export const { setVersionLoading, setVersionInfo } = appVersionSlice.actions;
export default appVersionSlice.reducer;
