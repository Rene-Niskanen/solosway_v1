/**
 * AuthGuard Component
 * Checks if user is authenticated before rendering protected content
 * Redirects to React login page if not authenticated
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backendApi } from '../services/backendApi';
import { AuthProvider } from '../contexts/AuthContext';

interface AuthGuardProps {
  children: React.ReactNode;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userInfo, setUserInfo] = useState<any>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const result = await backendApi.checkAuth();

        if (result.success && result.data) {
          setUserInfo(result.data.user || result.data);
          setIsAuthenticated(true);
          setIsLoading(false);
        } else {
          const statusCode = (result as any).statusCode;
          const isAuthError = statusCode === 401 || statusCode === 403 ||
            result.error?.includes('401') || result.error?.includes('403') ||
            result.error?.includes('Unauthorized') || result.error?.includes('Forbidden');

          if (isAuthError) {
            console.log('🔒 AuthGuard: Authentication failed - redirecting to login');
            localStorage.removeItem('isAuthenticated');
            setIsAuthenticated(false);
            setIsLoading(false);
          } else {
            console.warn('⚠️ AuthGuard: Auth check failed but keeping user logged in (might be temporary):', result.error);
            const hasPreviousAuth = localStorage.getItem('isAuthenticated') === 'true';
            setIsAuthenticated(!!hasPreviousAuth);
            setIsLoading(false);
          }
        }
      } catch (error) {
        console.error('Auth check error:', error);
        const hasPreviousAuth = localStorage.getItem('isAuthenticated') === 'true';
        setIsAuthenticated(!!hasPreviousAuth);
        setIsLoading(false);
      }
    };

    const justLoggedIn = sessionStorage.getItem('justLoggedIn');
    if (justLoggedIn === 'true') {
      sessionStorage.removeItem('justLoggedIn');
      localStorage.setItem('isAuthenticated', 'true');
      setIsAuthenticated(true);
      setIsLoading(false);
      checkAuth().catch(() => console.warn('Session verification failed, but allowing initial access'));
    } else {
      checkAuth();
    }

    // Fallback: stop loading after 15s if checkAuth never completes (e.g. backend down/slow after restart)
    const maxWaitId = setTimeout(() => {
      setIsLoading((loading) => {
        if (!loading) return loading;
        console.warn('⚠️ AuthGuard: Max wait (15s) reached; stopping loading. Backend may be slow or down.');
        return false;
      });
      setIsAuthenticated((prev) => (prev !== null ? prev : localStorage.getItem('isAuthenticated') === 'true'));
    }, 15000);
    return () => clearTimeout(maxWaitId);
  }, []);

  // When profile is updated (name, email, etc.), refresh auth state so Sidebar and other UI show new data
  useEffect(() => {
    const onRefresh = async () => {
      try {
        const result = await backendApi.checkAuth();
        if (result.success && result.data?.user) {
          setUserInfo(result.data.user);
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('authRefreshRequested', onRefresh);
    return () => window.removeEventListener('authRefreshRequested', onRefresh);
  }, []);

  // Redirect to /auth if not authenticated (but only if we're not already there)
  useEffect(() => {
    if (!isLoading && !isAuthenticated && window.location.pathname !== '/auth') {
      console.log('🔀 AuthGuard: Redirecting to /auth');
      navigate('/auth', { replace: true });
    }
  }, [isLoading, isAuthenticated, navigate]);

  // No loading screen - render children immediately. Auth check runs in background; redirects to /auth if not authenticated.
  if (isAuthenticated === false) {
    return null; // Will redirect to /auth via useEffect
  }

  // Render children (when authenticated or still loading - avoids loading screen)
  if (isAuthenticated) {
    console.log('✅ AuthGuard: Rendering protected content for user:', userInfo?.email);
  }
  // Update localStorage to track auth state
  if (isAuthenticated) {
    localStorage.setItem('isAuthenticated', 'true');
  }
  return <AuthProvider user={userInfo ?? null}>{children}</AuthProvider>;
};

