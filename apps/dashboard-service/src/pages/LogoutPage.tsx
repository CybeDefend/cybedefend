import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import useLogout from '../server/hooks/useLogout';

const LogoutPage: React.FC = () => {
    const logout = useLogout();

    useEffect(() => {
        logout();
    }, [logout]);

    return <Navigate to="/login" replace />;
};

export default LogoutPage;
