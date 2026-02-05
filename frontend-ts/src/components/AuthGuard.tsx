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
          setIsLoading(false);
        } else {
          // Only treat as auth failure if it's an actual authentication error (401/403)
          // For timeouts or network errors, keep user logged in (might be temporary)
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
            // Network error or timeout - keep user logged in, just log the error
            console.warn('⚠️ AuthGuard: Auth check failed but keeping user logged in (might be temporary):', result.error);
            // Assume authenticated if we have previous auth state, otherwise check localStorage
            const hasPreviousAuth = localStorage.getItem('isAuthenticated') === 'true';
            if (hasPreviousAuth) {
        setIsAuthenticated(true);
      } else {
              // First time check failed - treat as not authenticated
        setIsAuthenticated(false);
            }
            setIsLoading(false);
          }
      }
    } catch (error) {
        console.error('Auth check error:', error);
        // On error, check if we have previous auth state
        const hasPreviousAuth = localStorage.getItem('isAuthenticated') === 'true';
        if (hasPreviousAuth) {
          console.warn('⚠️ AuthGuard: Auth check error but keeping user logged in (might be temporary)');
          setIsAuthenticated(true);
        } else {
      setIsAuthenticated(false);
        }
      setIsLoading(false);
    }
  };

    // If we just logged in, do a quick non-blocking check
    const justLoggedIn = sessionStorage.getItem('justLoggedIn');
    if (justLoggedIn === 'true') {
      sessionStorage.removeItem('justLoggedIn');
      localStorage.setItem('isAuthenticated', 'true');
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

  // Shared loading screen with grow/shrink logo animation
  const loadingScreen = (
    <div className="flex h-screen items-center justify-center bg-background">
      <style>{`
        @keyframes auth-loading-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
        .auth-loading-logo {
          animation: auth-loading-pulse 1.2s ease-in-out infinite;
        }
      `}</style>
      <img
        src="/velora-dash-logo.png"
        alt=""
        className="auth-loading-logo h-14 w-auto object-contain block"
      />
    </div>
  );

  // Show loading state - Velora logo
  if (isLoading) {
    return loadingScreen;
  }

  // Show loading while redirecting or checking auth
  if (!isAuthenticated) {
    return loadingScreen;
  }

  // User is authenticated, render children
  console.log('✅ AuthGuard: Rendering protected content for user:', userInfo?.email);
  // Update localStorage to track auth state
  if (isAuthenticated) {
    localStorage.setItem('isAuthenticated', 'true');
  }
  return <>{children}</>;
};

