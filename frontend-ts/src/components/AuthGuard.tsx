/**
 * AuthGuard Component
 * Checks if user is authenticated before rendering protected content
 * Redirects to React login page if not authenticated
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backendApi } from '../services/backendApi';

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
        } else {
          setIsAuthenticated(false);
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    // If we just logged in, do a quick non-blocking check
    const justLoggedIn = sessionStorage.getItem('justLoggedIn');
    if (justLoggedIn === 'true') {
      sessionStorage.removeItem('justLoggedIn');
      // Trust login but verify in background
      setIsAuthenticated(true);
      setIsLoading(false);
      // Verify session exists (non-blocking)
      checkAuth().catch(() => {
        // If verification fails, user will be logged out on next API call
        console.warn('Session verification failed, but allowing initial access');
      });
    } else {
      // Normal check
      checkAuth();
    }
  }, []);

  // Redirect to /auth if not authenticated (but only if we're not already there)
  useEffect(() => {
    if (!isLoading && !isAuthenticated && window.location.pathname !== '/auth') {
      console.log('🔀 AuthGuard: Redirecting to /auth');
      navigate('/auth', { replace: true });
    }
  }, [isLoading, isAuthenticated, navigate]);

  // Show loading state - minimal and fast
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-primary border-r-transparent"></div>
      </div>
    );
  }

  // Show loading while redirecting or checking auth
  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-primary border-r-transparent"></div>
      </div>
    );
  }

  // User is authenticated, render children
  console.log('✅ AuthGuard: Rendering protected content for user:', userInfo?.email);
  return <>{children}</>;
};

