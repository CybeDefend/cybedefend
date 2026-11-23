
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface AuthState {
    accessToken: string | null;
    isAuthenticated: boolean;
    justLoggedOut?: boolean;
}

// With Logto, tokens are managed by the SDK (in-memory + localStorage via @logto/react).
// authSlice just mirrors the current token for use by gatewayAPI interceptors.
const initialState: AuthState = {
    accessToken: null,
    isAuthenticated: false,
    justLoggedOut: false,
};

const authSlice = createSlice({
    name: 'auth',
    initialState,
    reducers: {
        setAccessToken(state, action: PayloadAction<string>) {
            state.accessToken = action.payload;
            state.isAuthenticated = true;
            state.justLoggedOut = false;
        },
        clearAccessToken(state) {
            state.accessToken = null;
            state.isAuthenticated = false;
            state.justLoggedOut = true;
        },
    },
});

export const { setAccessToken, clearAccessToken } = authSlice.actions;
export default authSlice.reducer;
