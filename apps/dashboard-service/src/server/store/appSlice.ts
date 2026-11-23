import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface AppState {
  /**
   * Indicates whether the initial app setup is complete.
   * This includes user profile fetch and organization selection.
   */
  isAppInitialized: boolean;
  
  /**
   * Indicates whether user profile and organization data are stable.
   * When true, protected routes can safely fetch their data.
   */
  isDataStable: boolean;
  
  /**
   * Tracks if we're currently in the process of setting up the app
   */
  isInitializing: boolean;
}

const initialState: AppState = {
  isAppInitialized: false,
  isDataStable: false,
  isInitializing: false,
};

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    /**
     * Marks the start of app initialization process
     */
    startAppInitialization: (state) => {
      state.isInitializing = true;
      state.isAppInitialized = false;
      state.isDataStable = false;
    },
    
    /**
     * Marks the completion of app initialization.
     * This should be called when:
     * - User profile is fetched
     * - Organization is selected
     * - All required app state is set
     */
    completeAppInitialization: (state) => {
      state.isInitializing = false;
      state.isAppInitialized = true;
      state.isDataStable = true;
    },
    
    /**
     * Marks data as unstable (e.g., during organization changes)
     */
    markDataUnstable: (state) => {
      state.isDataStable = false;
    },
    
    /**
     * Marks data as stable again (e.g., after organization change is complete)
     */
    markDataStable: (state) => {
      state.isDataStable = true;
    },
    
    /**
     * Reset app state (e.g., on logout)
     */
    resetAppState: (state) => {
      state.isAppInitialized = false;
      state.isDataStable = false;
      state.isInitializing = false;
    },
  },
});

export const {
  startAppInitialization,
  completeAppInitialization,
  markDataUnstable,
  markDataStable,
  resetAppState,
} = appSlice.actions;

export default appSlice.reducer;
