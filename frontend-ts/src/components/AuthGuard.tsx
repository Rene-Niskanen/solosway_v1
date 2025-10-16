/**
 * AuthGuard Component
 * Checks if user is authenticated before rendering protected content
 * Redirects to React login page if not authenticated
 */

import React, { useEffect, useState } from 'react';
import { backendApi } from '../services/backendApi';

interface AuthGuardProps {
  children: React.ReactNode;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userInfo, setUserInfo] = useState<any>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      console.log('🔐 AuthGuard: Checking authentication...');
      
      // Use backendApi service for consistent URL handling
      const result = await backendApi.checkAuth();
      
      console.log('🔍 AuthGuard: Auth result:', result);
      
      if (result.success && result.data) {
        console.log('✅ AuthGuard: User authenticated', result.data.user);
        setUserInfo(result.data.user);
        setIsAuthenticated(true);
      } else {
        console.log('❌ AuthGuard: Not authenticated, error:', result.error);
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('❌ AuthGuard: Auth check failed:', error);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent mx-auto mb-4"></div>
          <p className="text-lg text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    console.log('🔀 AuthGuard: User not authenticated, showing login...');
    
    // Import Login component dynamically
    const Login = React.lazy(() => import('./Login'));
    
    return (
      <React.Suspense
        fallback={
          <div className="flex h-screen items-center justify-center bg-background">
            <div className="text-center">
              <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent mx-auto mb-4"></div>
              <p className="text-lg text-muted-foreground">Loading...</p>
            </div>
          </div>
        }
      >
        <Login onLoginSuccess={checkAuth} />
      </React.Suspense>
    );
  }

  // User is authenticated, render children
  console.log('✅ AuthGuard: Rendering protected content for user:', userInfo?.email);
  return <>{children}</>;
};

