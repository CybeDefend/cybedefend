import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { authClient } from '@/edition/auth/useAuth';
import { clearAccessToken } from '../store/authSlice';

const useLogout = () => {
    const dispatch = useDispatch();

    const logout = useCallback(async () => {
        try {
            dispatch(clearAccessToken());
            // The edition's client ends the session: in the cloud, Logto's
            // end-session endpoint, then back to our app's post-logout
            // redirect URI (login page)
            await authClient.signOut();
        } catch (error) {
            throw error;
        }
    }, [dispatch]);

    return logout;
};

export default useLogout;
