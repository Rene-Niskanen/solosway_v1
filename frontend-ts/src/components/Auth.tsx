import React, { useState, useRef, useCallback, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock } from 'lucide-react';
import { backendApi } from '../services/backendApi';

interface AuthFormData {
  email: string;
  password: string;
  confirmPassword?: string;
  firstName?: string;
  companyName?: string;
}

const Auth: React.FC = () => {
  const [isLoginMode, setIsLoginMode] = useState(true);
  // Use refs for form data to avoid re-renders on every keystroke
  const formDataRef = useRef<AuthFormData>({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    companyName: ''
  });
  // Only use state for values that affect UI rendering
  const [formData, setFormData] = useState<AuthFormData>(formDataRef.current);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const errorRef = useRef(error);
  // Refs for all input elements to pre-initialize them and bypass extension interference
  const firstNameInputRef = useRef<HTMLInputElement>(null);
  const companyNameInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const confirmPasswordInputRef = useRef<HTMLInputElement>(null);
  
  // Keep error ref in sync - use ref callback to avoid effect
  const updateErrorRef = useCallback((newError: string) => {
    errorRef.current = newError;
  }, []);
  
  // Sync ref with state when state changes externally - only when needed
  React.useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);
  
  // Update error ref when error changes
  React.useEffect(() => {
    updateErrorRef(error);
  }, [error, updateErrorRef]);

  // Aggressively pre-initialize all inputs on mount to eliminate first-click delay
  // This runs synchronously in useLayoutEffect (before paint) to beat extension initialization
  useLayoutEffect(() => {
    const initializeInput = (input: HTMLInputElement) => {
      // Skip if already initialized
      if ((input as any).__authInitialized) return;
      
      // Force React to initialize event handlers by accessing the element
      void input.offsetHeight; // Force layout read to trigger browser optimization
      
      // Add native event listeners as fallback to bypass extension interference
      // These fire before React's synthetic events and extension listeners
      const nativeFocusHandler = () => {
        // Ensure input is focused instantly, bypassing any delays
        if (document.activeElement !== input) {
          input.focus();
        }
      };
      
      const nativeClickHandler = (e: MouseEvent) => {
        // If this is a click on the input, focus it immediately
        if (e.target === input) {
          e.stopPropagation(); // Prevent extension interference
          nativeFocusHandler();
        }
      };

      // Attach native listeners with capture phase to fire before extensions
      input.addEventListener('click', nativeClickHandler, { capture: true, passive: false });
      input.addEventListener('mousedown', nativeFocusHandler, { capture: true, passive: false });
      
      // Mark as initialized and store cleanup function
      (input as any).__authInitialized = true;
      (input as any).__authCleanup = () => {
        input.removeEventListener('click', nativeClickHandler, { capture: true });
        input.removeEventListener('mousedown', nativeFocusHandler, { capture: true });
        (input as any).__authInitialized = false;
      };
    };

    // Initialize all available inputs (some may be conditionally rendered)
    const inputs = [
      emailInputRef.current,
      passwordInputRef.current,
      firstNameInputRef.current,
      companyNameInputRef.current,
      confirmPasswordInputRef.current
    ].filter(Boolean) as HTMLInputElement[];

    inputs.forEach(initializeInput);

    // Cleanup function
    return () => {
      inputs.forEach((input) => {
        if ((input as any).__authCleanup) {
          (input as any).__authCleanup();
        }
      });
    };
  }, [isLoginMode]); // Re-run when mode changes to initialize signup fields

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    // Update ref immediately for instant access
    formDataRef.current = {
      ...formDataRef.current,
      [name]: value
    };
    // Update state immediately - no batching for input responsiveness
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  }, []);
  
  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Clear error when user starts typing - using onInput for immediate feedback
    if (errorRef.current) {
      errorRef.current = '';
      setError('');
    }
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Use ref data for immediate access without waiting for state
    const currentData = formDataRef.current;

    try {
      if (isLoginMode) {
        // Login mode
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
        const response = await fetch(`${backendUrl}/api/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ 
            email: currentData.email, 
            password: currentData.password 
          }),
        });

        const data = await response.json();

        if (data.success) {
          console.log('✅ Login successful!');
          navigate('/dashboard');
        } else {
          setError(data.message || 'Invalid credentials');
        }
      } else {
        // Signup mode
        // Validation
        if (currentData.password !== currentData.confirmPassword) {
          setError('Passwords do not match');
          setLoading(false);
          return;
        }

        if (currentData.password.length < 6) {
          setError('Password must be at least 6 characters long');
          setLoading(false);
          return;
        }

        const result = await backendApi.signUp({
          email: currentData.email,
          password: currentData.password,
          firstName: currentData.firstName || '',
          companyName: currentData.companyName || ''
        });

        if (result.success) {
          console.log('✅ Signup successful! Redirecting to dashboard...');
          navigate('/dashboard');
        } else {
          setError(result.error || 'Failed to create account');
        }
      }
    } catch (err) {
      console.error('Auth error:', err);
      setError(isLoginMode 
        ? 'Failed to connect to server. Please try again.' 
        : 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [isLoginMode, navigate]);

  const toggleMode = useCallback(() => {
    // Instant mode switch with no delays
    setIsLoginMode(prev => !prev);
    setError('');
    errorRef.current = '';
    // Reset form data when switching modes - use ref for instant update
    const emptyData = {
      email: '',
      password: '',
      confirmPassword: '',
      firstName: '',
      companyName: ''
    };
    formDataRef.current = emptyData;
    // Update state immediately for instant UI response
    setFormData(emptyData);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ backgroundColor: '#DAEEFF' }}>
      
      {/* Content Container - wider card with two columns */}
      <div className="relative z-10 w-full max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg flex flex-col lg:flex-row overflow-hidden">
          {/* Left Column - Image */}
          <div className="lg:w-1/2 h-auto lg:h-auto">
            <img 
              src="/Sign in/signup&login.png" 
              alt="Sign in illustration"
              className="w-full h-full object-cover"
            />
          </div>
          
          {/* Right Column - Form */}
          <div className="w-full lg:w-1/2 p-6 sm:p-8 lg:p-10">
            {/* Title - memoized to prevent re-render */}
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-8">
              {isLoginMode ? 'Login to your account' : 'Create your account'}
            </h1>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-8" autoComplete="off" data-lpignore="true" data-form-type="other">
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            {/* Signup-only fields - use CSS visibility for instant show/hide */}
            <div className={`grid grid-cols-2 gap-6 ${isLoginMode ? 'hidden' : ''}`}>
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-3">
                    First Name
                  </label>
                  <input
                    ref={firstNameInputRef}
                    id="firstName"
                    name="firstName"
                    type="text"
                    required={!isLoginMode}
                  value={formData.firstName}
                  onChange={handleChange}
                  onInput={handleInput}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none will-change-auto focus:outline-none"
                    style={{ transition: 'none', WebkitTapHighlightColor: 'transparent' }}
                    placeholder="Enter your first name"
                    disabled={loading}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                  />
                </div>

                <div>
                  <label htmlFor="companyName" className="block text-sm font-medium text-gray-700 mb-3">
                    Company Name
                  </label>
                  <input
                    ref={companyNameInputRef}
                    id="companyName"
                    name="companyName"
                    type="text"
                    required={!isLoginMode}
                    value={formData.companyName}
                    onChange={handleChange}
                    onInput={handleInput}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none will-change-auto focus:outline-none"
                    style={{ transition: 'none', WebkitTapHighlightColor: 'transparent' }}
                    placeholder="Enter your company name"
                    disabled={loading}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                  />
                </div>
              </div>

            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-3">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5 pointer-events-none" />
                <input
                  ref={emailInputRef}
                  type="email"
                  id="email"
                  name="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  onInput={handleInput}
                  className="w-full px-4 py-2.5 pl-12 border border-gray-300 rounded-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none will-change-auto focus:outline-none"
                  style={{ transition: 'none', WebkitTapHighlightColor: 'transparent' }}
                  placeholder="Email"
                  disabled={loading}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-3">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5 pointer-events-none" />
                <input
                  ref={passwordInputRef}
                  type="password"
                  id="password"
                  name="password"
                  required
                  value={formData.password}
                  onChange={handleChange}
                  onInput={handleInput}
                  className="w-full px-4 py-2.5 pl-12 border border-gray-300 rounded-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none will-change-auto focus:outline-none"
                  style={{ transition: 'none', WebkitTapHighlightColor: 'transparent' }}
                  placeholder="Password"
                  disabled={loading}
                  autoComplete={isLoginMode ? "current-password" : "new-password"}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  data-form-type="other"
                  data-lpignore="true"
                />
              </div>
            </div>

            {/* Confirm Password (Signup only) - use CSS visibility for instant show/hide */}
            <div className={isLoginMode ? 'hidden' : ''}>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-3">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5 pointer-events-none" />
                <input
                    ref={confirmPasswordInputRef}
                    type="password"
                    id="confirmPassword"
                    name="confirmPassword"
                    required={!isLoginMode}
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    onInput={handleInput}
                  className="w-full px-4 py-2.5 pl-12 border border-gray-300 rounded-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none will-change-auto focus:outline-none"
                  style={{ transition: 'none', WebkitTapHighlightColor: 'transparent' }}
                  placeholder="Confirm password"
                  disabled={loading}
                  autoComplete="new-password"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  data-form-type="other"
                  data-lpignore="true"
                />
              </div>
            </div>

            {/* Forgot Password Link (Login only) - use CSS visibility for instant show/hide */}
            <div className={`flex justify-end -mt-1 mb-2 ${!isLoginMode ? 'hidden' : ''}`}>
              <button
                type="button"
                className="text-sm text-gray-600 hover:text-gray-900"
                style={{ transition: 'none' }}
              >
                Forgot password?
              </button>
            </div>

            {/* Continue Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-b from-blue-400 to-blue-600 text-white py-3 px-4 rounded-none font-medium hover:from-blue-500 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md mt-6"
              style={{ transition: 'none' }}
            >
              {loading ? (isLoginMode ? 'Signing in...' : 'Creating Account...') : 'Continue'}
            </button>

            {/* Social Login Section */}
            <div className="pt-8">
              <p className="text-center text-sm text-gray-600 mb-6">Sign in With</p>
              <div className="flex justify-center gap-4">
                {/* Facebook */}
                <button
                  type="button"
                  className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center hover:bg-blue-700 shadow-sm"
                  style={{ transition: 'none' }}
                  aria-label="Sign in with Facebook"
                >
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                </button>

                {/* Google */}
                <button
                  type="button"
                  className="w-10 h-10 rounded-full bg-white border border-gray-300 flex items-center justify-center hover:bg-gray-50 shadow-sm"
                  style={{ transition: 'none' }}
                  aria-label="Sign in with Google"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                </button>

                {/* Apple */}
                <button
                  type="button"
                  className="w-10 h-10 rounded-full bg-black flex items-center justify-center hover:bg-gray-800 shadow-sm"
                  style={{ transition: 'none' }}
                  aria-label="Sign in with Apple"
                >
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Toggle Link */}
            <div className="text-center pt-8">
              <p className="text-sm text-gray-600">
                {isLoginMode ? "Don't have an account? " : 'Already have an account? '}
                <button
                  type="button"
                  onClick={toggleMode}
                  className="text-blue-600 hover:text-blue-700 font-medium"
                  style={{ transition: 'none' }}
                >
                  {isLoginMode ? 'Sign up' : 'Sign in'}
                </button>
              </p>
            </div>
          </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;

