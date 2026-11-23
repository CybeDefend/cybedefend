
import { configureStore } from '@reduxjs/toolkit';
import { ACTIVE_EXTENSIONS } from '@/edition/active';
import authReducer from './authSlice';
import userReducer from './userSlice';
import organizationReducer from './organizationSlice';
import appReducer from './appSlice';
import appVersionReducer from './appVersionSlice';
import invitationReducer from './invitationSlice';
import backgroundTasksReducer from './backgroundTasksSlice';

const store = configureStore({
  reducer: {
    auth: authReducer,
    user: userReducer,
    organization: organizationReducer,
    app: appReducer,
    appVersion: appVersionReducer,
    invitation: invitationReducer,
    backgroundTasks: backgroundTasksReducer,
    // The closed tree's slices (the Cybe chat's `globalChat`), registered through
    // the edition entry; empty in a community build.
    ...ACTIVE_EXTENSIONS.reducers,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
