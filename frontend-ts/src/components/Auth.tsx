import React, { useState, useRef, useCallback, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock } from 'lucide-react';
import { backendApi } from '../services/backendApi';

interface AuthFormData {
  email: string;
  password: string;
  confirmPassword?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
}

const Auth: React.FC = () => {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [loginStep, setLoginStep] = useState<1 | 2>(1); // Step 1: Email + Continue; Step 2: Password + Sign in
  // Use refs for form data to avoid re-renders on every keystroke
  const formDataRef = useRef<AuthFormData>({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    companyName: ''
  });
  // Only use state for values that affect UI rendering
  const [formData, setFormData] = useState<AuthFormData>(formDataRef.current);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const navigate = useNavigate();
  const errorRef = useRef(error);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  // Refs for all input elements to pre-initialize them and bypass extension interference
  const firstNameInputRef = useRef<HTMLInputElement>(null);
  const lastNameInputRef = useRef<HTMLInputElement>(null);
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

  // Disable document scroll on login page
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

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
      lastNameInputRef.current,
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
  }, [isLoginMode, loginStep]); // Re-run when mode or login step changes to initialize fields

  // Ref callback for email input - sets up handlers immediately when element is created
  const emailInputRefCallback = React.useCallback((node: HTMLInputElement | null) => {
    if (node) {
      emailInputRef.current = node;
      
      // ULTRA-INSTANT focus - no delays, no checks, just focus NOW
      const immediateFocus = () => {
        // Try immediate focus first (synchronous)
        try {
          node.focus();
        } catch (e) {
          // Fallback if focus fails
        }
      };
      
      // Handle pointerdown (fires FIRST, before mousedown) for absolute fastest response
      const handlePointerDown = (e: PointerEvent) => {
        if (e.target === node) {
          e.stopImmediatePropagation(); // Stop ALL handlers
          e.preventDefault();
          immediateFocus();
        }
      };
      
      // Handle mousedown (fires before click) for instant response
      const handleMouseDown = (e: MouseEvent) => {
        if (e.target === node) {
          e.stopImmediatePropagation(); // Stop ALL other handlers
          e.preventDefault();
          immediateFocus();
        }
      };
      
      // Handle click as backup
      const handleClick = (e: MouseEvent) => {
        if (e.target === node) {
          e.stopImmediatePropagation();
          e.preventDefault();
          immediateFocus();
        }
      };
      
      // Handle touch for mobile
      const handleTouchStart = (e: TouchEvent) => {
        if (e.target === node) {
          e.stopImmediatePropagation();
          e.preventDefault();
          immediateFocus();
        }
      };
      
      // CRITICAL: Attach listeners to DOCUMENT in capture phase BEFORE React
      // This ensures our handlers fire before ANY other handlers, including React's
      const docHandlePointerDown = (e: PointerEvent) => {
        if (e.target === node) {
          e.stopImmediatePropagation();
          e.preventDefault();
          immediateFocus();
        }
      };
      
      const docHandleMouseDown = (e: MouseEvent) => {
        if (e.target === node) {
          e.stopImmediatePropagation();
          e.preventDefault();
          immediateFocus();
        }
      };
      
      // Attach to document FIRST (highest priority)
      document.addEventListener('pointerdown', docHandlePointerDown, { 
        capture: true, 
        passive: false
      });
      document.addEventListener('mousedown', docHandleMouseDown, { 
        capture: true, 
        passive: false
      });
      
      // Also attach to node itself
      node.addEventListener('pointerdown', handlePointerDown, { 
        capture: true, 
        passive: false
      });
      node.addEventListener('mousedown', handleMouseDown, { 
        capture: true, 
        passive: false
      });
      node.addEventListener('click', handleClick, { 
        capture: true, 
        passive: false
      });
      node.addEventListener('touchstart', handleTouchStart, { 
        capture: true, 
        passive: false
      });
      
      // Force browser to prepare the element immediately
      void node.offsetHeight;
      node.style.pointerEvents = 'auto';
      node.style.cursor = 'text';
      node.setAttribute('tabindex', '0');
      
      // Store cleanup
      (node as any).__emailCleanup = () => {
        document.removeEventListener('pointerdown', docHandlePointerDown, { capture: true });
        document.removeEventListener('mousedown', docHandleMouseDown, { capture: true });
        node.removeEventListener('pointerdown', handlePointerDown, { capture: true });
        node.removeEventListener('mousedown', handleMouseDown, { capture: true });
        node.removeEventListener('click', handleClick, { capture: true });
        node.removeEventListener('touchstart', handleTouchStart, { capture: true });
      };
    } else if (emailInputRef.current) {
      // Cleanup when node is removed
      const cleanup = (emailInputRef.current as any).__emailCleanup;
      if (cleanup) cleanup();
    }
  }, []);

  // Ref callback for password input - sets up handlers immediately when element is created
  const passwordInputRefCallback = React.useCallback((node: HTMLInputElement | null) => {
    if (node) {
      passwordInputRef.current = node;
      
      // ULTRA-INSTANT focus - no delays, no checks, just focus NOW
      const immediateFocus = () => {
        // Try immediate focus first (synchronous)
        try {
          node.focus();
        } catch (e) {
          // Fallback if focus fails
        }
      };
      
      // Handle pointerdown (fires FIRST, before mousedown) for absolute fastest response
      const handlePointerDown = (e: PointerEvent) => {
        if (e.target === node) {
          e.stopImmediatePropagation(); // Stop ALL handlers
          e.preventDefault();
          immediateFocus();
        }
      };
      
      // Handle mousedown (fires before click) for instant response
      const handleMouseDown = (e: MouseEvent) => {
        if (e.target === node) {
          e.stopImmediatePropagation(); // Stop ALL other handlers
          e.preventDefault();
          immediateFocus();
        }
      };
      
      // Handle click as backup
      const handleClick = (e: MouseEvent) => {
        if (e.target === node) {
          e.stopImmediatePropagation();
          e.preventDefault();
          immediateFocus();
        }
      };
      
      // Handle touch for mobile
      const handleTouchStart = (e: TouchEvent) => {
        if (e.target === node) {
          e.stopImmediatePropagation();
          e.preventDefault();
          immediateFocus();
        }
      };
      
      // CRITICAL: Attach listeners to DOCUMENT in capture phase BEFORE React
      // This ensures our handlers fire before ANY other handlers, including React's
      const docHandlePointerDown = (e: PointerEvent) => {
        if (e.target === node) {
          e.stopImmediatePropagation();
          e.preventDefault();
          immediateFocus();
        }
      };
      
      const docHandleMouseDown = (e: MouseEvent) => {
        if (e.target === node) {
          e.stopImmediatePropagation();
          e.preventDefault();
          immediateFocus();
        }
      };
      
      // Attach to document FIRST (highest priority)
      document.addEventListener('pointerdown', docHandlePointerDown, { 
        capture: true, 
        passive: false
      });
      document.addEventListener('mousedown', docHandleMouseDown, { 
        capture: true, 
        passive: false
      });
      
      // Also attach to node itself
      node.addEventListener('pointerdown', handlePointerDown, { 
        capture: true, 
        passive: false
      });
      node.addEventListener('mousedown', handleMouseDown, { 
        capture: true, 
        passive: false
      });
      node.addEventListener('click', handleClick, { 
        capture: true, 
        passive: false
      });
      node.addEventListener('touchstart', handleTouchStart, { 
        capture: true, 
        passive: false
      });
      
      // Force browser to prepare the element immediately
      void node.offsetHeight;
      node.style.pointerEvents = 'auto';
      node.style.cursor = 'text';
      node.setAttribute('tabindex', '0');
      
      // Store cleanup
      (node as any).__passwordCleanup = () => {
        document.removeEventListener('pointerdown', docHandlePointerDown, { capture: true });
        document.removeEventListener('mousedown', docHandleMouseDown, { capture: true });
        node.removeEventListener('pointerdown', handlePointerDown, { capture: true });
        node.removeEventListener('mousedown', handleMouseDown, { capture: true });
        node.removeEventListener('click', handleClick, { capture: true });
        node.removeEventListener('touchstart', handleTouchStart, { capture: true });
      };
    } else if (passwordInputRef.current) {
      // Cleanup when node is removed
      const cleanup = (passwordInputRef.current as any).__passwordCleanup;
      if (cleanup) cleanup();
    }
  }, []);

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

  const handleContinueToPassword = useCallback(() => {
    const email = formDataRef.current.email?.trim();
    if (!email) {
      setError('Please enter your email.');
      return;
    }
    setError('');
    setLoginStep(2);
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    // Login step 1: Continue advances to password step instead of submitting
    if (isLoginMode && loginStep === 1) {
      handleContinueToPassword();
      return;
    }
    setError('');
    setLoading(true);

    // Use ref data for immediate access without waiting for state
    const currentData = formDataRef.current;

    try {
      if (isLoginMode) {
        // Login mode
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';
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
          setLoading(false);
          // Mark that we just logged in so AuthGuard trusts it
          sessionStorage.setItem('justLoggedIn', 'true');
          localStorage.setItem('isAuthenticated', 'true');
          navigate('/dashboard', { replace: true });
        } else {
          setError(data.message || 'Invalid credentials');
          setLoading(false);
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
          lastName: currentData.lastName || '',
          companyName: currentData.companyName || ''
        });

        if (result.success) {
          console.log('✅ Signup successful! Redirecting to dashboard...');
          sessionStorage.setItem('justLoggedIn', 'true');
          localStorage.setItem('isAuthenticated', 'true');
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
  }, [isLoginMode, loginStep, navigate, handleContinueToPassword]);

  const handleGoogleOAuthError = useCallback((error: any) => {
    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'unknown';
    const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    
    let errorMessage = 'Google sign-in error. ';
    
    if (error === 'popup_closed_by_user' || error?.type === 'popup_closed_by_user') {
      errorMessage = 'Sign-in was cancelled.';
    } else if (error?.includes('invalid_client') || error?.includes('no registered origin')) {
      errorMessage = `OAuth configuration error. Please add "${currentOrigin}" to "Authorized JavaScript origins" in Google Cloud Console.`;
      console.error('🔧 OAuth Configuration Fix:');
      console.error(`   1. Go to https://console.cloud.google.com/apis/credentials`);
      console.error(`   2. Find your OAuth 2.0 Client ID: ${googleClientId?.substring(0, 20)}...`);
      console.error(`   3. Click "Edit" and add "${currentOrigin}" to "Authorized JavaScript origins"`);
      console.error(`   4. Save and wait 1-2 minutes for changes to propagate`);
    } else {
      errorMessage += error?.toString() || 'Unknown error occurred.';
    }
    
    setError(errorMessage);
    setGoogleLoading(false);
  }, []);

  const handleGoogleSignIn = useCallback(async (credential: string) => {
    setError('');
    setGoogleLoading(true);
    
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';
      const response = await fetch(`${backendUrl}/api/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ credential }),
      });

      const result = await response.json();

      if (result.success) {
        console.log('✅ Google sign-in successful! Redirecting to dashboard...');
        sessionStorage.setItem('justLoggedIn', 'true');
        localStorage.setItem('isAuthenticated', 'true');
        navigate('/dashboard');
      } else {
        setError(result.error || 'Failed to sign in with Google');
      }
    } catch (err) {
      console.error('Google sign-in error:', err);
      setError('Network error. Please try again.');
    } finally {
      setGoogleLoading(false);
    }
  }, [navigate]);

  // Initialize Google Identity Services
  React.useEffect(() => {
    const initializeGoogleSignIn = () => {
      const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'unknown';
      
      if (!googleClientId) {
        console.warn('⚠️ VITE_GOOGLE_CLIENT_ID is not set. Google sign-in will not work.');
        console.info('📝 To enable Google sign-in:');
        console.info('   1. Get a Google OAuth Client ID from https://console.cloud.google.com/apis/credentials');
        console.info('   2. Add it to your .env file as VITE_GOOGLE_CLIENT_ID=your-client-id');
        console.info(`   3. Make sure "${currentOrigin}" is added to "Authorized JavaScript origins" in Google Cloud Console`);
        return;
      }

      if (typeof window !== 'undefined' && (window as any).google) {
        const google = (window as any).google;
        
        try {
          google.accounts.id.initialize({
            client_id: googleClientId,
            callback: (response: any) => {
              if (response.credential) {
                handleGoogleSignIn(response.credential);
              } else if (response.error) {
                console.error('Google OAuth error:', response.error);
                handleGoogleOAuthError(response.error);
              }
            },
            error_callback: (error: any) => {
              console.error('Google Identity Services error:', error);
              handleGoogleOAuthError(error);
            },
          });

          // Don't render Google's button - we use our custom button instead
          // The googleButtonRef is kept for potential future use but not rendered
        } catch (error: any) {
          console.error('Error initializing Google Identity Services:', error);
          handleGoogleOAuthError(error);
        }
      }
    };

    // Wait for Google Identity Services to load
    if (typeof window !== 'undefined') {
      if ((window as any).google) {
        initializeGoogleSignIn();
      } else {
        // Poll for Google to be available
        const checkGoogle = setInterval(() => {
          if ((window as any).google) {
            clearInterval(checkGoogle);
            initializeGoogleSignIn();
          }
        }, 100);

        // Cleanup after 10 seconds
        setTimeout(() => clearInterval(checkGoogle), 10000);
      }
    }
  }, [handleGoogleSignIn, handleGoogleOAuthError]);

  // Trigger Google sign-in - opens Google OAuth popup
  const triggerGoogleSignIn = useCallback(() => {
    const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'unknown';
    
    if (!googleClientId) {
      setError(`Google sign-in is not configured. Please add VITE_GOOGLE_CLIENT_ID to your .env file.`);
      console.error('🔧 Configuration Fix:');
      console.error('   1. Get a Google OAuth Client ID from https://console.cloud.google.com/apis/credentials');
      console.error('   2. Add it to your .env file as VITE_GOOGLE_CLIENT_ID=your-client-id');
      console.error(`   3. Make sure "${currentOrigin}" is added to "Authorized JavaScript origins"`);
      return;
    }

    if (typeof window !== 'undefined' && (window as any).google) {
      const google = (window as any).google;
      setGoogleLoading(true);
      
      try {
        // Ensure Google Identity Services is initialized
        google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (response: any) => {
            setGoogleLoading(false);
            if (response.credential) {
              handleGoogleSignIn(response.credential);
            } else if (response.error) {
              handleGoogleOAuthError(response.error);
            }
          },
          error_callback: (error: any) => {
            setGoogleLoading(false);
            handleGoogleOAuthError(error);
          },
        });

        // Render a hidden Google button and click it programmatically
        // This is the most reliable way to trigger the popup
        if (googleButtonRef.current) {
          googleButtonRef.current.innerHTML = '';
          google.accounts.id.renderButton(
            googleButtonRef.current,
            {
              theme: 'outline',
              size: 'large',
              width: '100%',
              text: 'signin_with',
              locale: 'en',
            }
          );
          
          // Click the rendered button immediately
          setTimeout(() => {
            const button = googleButtonRef.current?.querySelector('div[role="button"]') as HTMLElement;
            if (button) {
              button.click();
            } else {
              // Fallback: try One Tap prompt
              google.accounts.id.prompt();
              setGoogleLoading(false);
            }
          }, 50);
        } else {
          // Fallback: use One Tap prompt
          google.accounts.id.prompt();
          setGoogleLoading(false);
        }
      } catch (error: any) {
        setGoogleLoading(false);
        console.error('Error triggering Google sign-in:', error);
        handleGoogleOAuthError(error);
      }
    } else {
      setError('Google sign-in is loading. Please wait a moment and try again.');
      setGoogleLoading(false);
    }
  }, [handleGoogleSignIn, handleGoogleOAuthError]);

  const toggleMode = useCallback(() => {
    // Instant mode switch with no delays
    setIsLoginMode(prev => !prev);
    setLoginStep(1);
    setError('');
    errorRef.current = '';
    // Reset form data when switching modes - use ref for instant update
    const emptyData = {
      email: '',
      password: '',
      confirmPassword: '',
      firstName: '',
      lastName: '',
      companyName: ''
    };
    formDataRef.current = emptyData;
    // Update state immediately for instant UI response
    setFormData(emptyData);
  }, []);

  const showPasswordStep = isLoginMode && loginStep === 2;
  const showSignupFields = !isLoginMode;
  const showEmailStep = isLoginMode && loginStep === 1;

  return (
    <div className="h-screen min-h-0 flex flex-col md:flex-row md:gap-0 overflow-hidden">
      {/* Left column: white form panel */}
      <div className="w-full md:min-w-[380px] md:w-[40%] flex-shrink-0 bg-white flex flex-col min-h-0 flex-1 md:flex-none overflow-hidden">
        <div className="flex-1 flex flex-col justify-center px-8 py-12 md:px-10 md:py-16 max-w-md mx-auto w-full auth-form">
          <form
            onSubmit={handleSubmit}
            className=""
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            data-form-type="other"
            onClick={(e) => {
              if ((e.target as HTMLElement).tagName === 'INPUT') return;
            }}
            style={{ pointerEvents: 'auto' }}
          >
            <style>{`
              .auth-form * { font-family: 'DM Sans', system-ui, sans-serif; }
              .auth-form .auth-form-text { color: #090909; }
              .auth-form .auth-form-heading-intro { font-weight: 300 !important; }
              .auth-input { color: #090909 !important; }
              .auth-input::placeholder { color: #9ca3af; opacity: 1; }
              .auth-input::-webkit-input-placeholder { color: #9ca3af; }
              .auth-input::-moz-placeholder { color: #9ca3af; opacity: 1; }
            `}</style>

            <div 
              ref={googleButtonRef}
              id="google-signin-button-hidden"
              className="absolute opacity-0 pointer-events-none w-0 h-0 overflow-hidden"
              aria-hidden
            />

            <h1 className="auth-form-text text-2xl md:text-3xl text-center mb-12 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
              <span className="auth-form-heading-intro">Get started with</span>
              <img
                src="/VELORA_WRITINGLOGO.png"
                alt="VELORA"
                className="h-8 md:h-9 object-contain object-left inline-block"
                style={{ width: 'auto', maxWidth: '160px' }}
              />
            </h1>

            {error && (
              <div className="text-red-600 px-4 py-3 rounded-lg text-sm text-center mb-4 bg-red-50 border border-red-100">
                {error}
              </div>
            )}

            {/* Spacer above Google button */}
            <div className="h-12 shrink-0" style={{ minHeight: '3rem' }} aria-hidden="true" />

            <button
              type="button"
              onClick={triggerGoogleSignIn}
              disabled={googleLoading}
              className="auth-form-text w-full py-3 px-4 rounded-lg font-medium focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors mt-0 mb-0"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" className="flex-shrink-0">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.22-.163-1.782H9v3.38h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.575z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.712 0-.595.102-1.172.282-1.712V4.956H.957C.348 6.174 0 7.55 0 9c0 1.45.348 2.826.957 4.044l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.956L3.964 7.288C4.672 5.163 6.656 3.58 9 3.58z"/>
              </svg>
              Continue with Google
            </button>

            <div className="flex items-center gap-4 mt-5 mb-5">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="auth-form-text text-sm">OR</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* Email field: step 1 login only - squared outline with icon */}
            {showEmailStep && (
              <div>
                <div className="flex items-center gap-3 w-full border border-gray-200 rounded-none bg-white px-4 py-3.5 focus-within:border-gray-400 focus-within:outline-none">
                  <Mail className="w-5 h-5 text-gray-400 flex-shrink-0" aria-hidden />
                  <input
                    ref={emailInputRefCallback}
                    type="email"
                    id="email"
                    name="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    onInput={handleInput}
                    className="auth-input flex-1 min-w-0 border-0 bg-transparent outline-none text-base p-0"
                    placeholder="Email"
                    disabled={loading}
                    autoComplete="off"
                    tabIndex={0}
                    data-no-delay="true"
                  />
                </div>
              </div>
            )}

            {/* Step 1: Continue button (login only) */}
            {showEmailStep && (
              <>
                <button
                  type="button"
                  onClick={handleContinueToPassword}
                  disabled={loading}
                  className="w-full py-3 px-4 rounded-lg font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#909FF7] disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-4 mb-0"
                  style={{ backgroundColor: '#909FF7' }}
                  onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = '#7b8bf5'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#909FF7'; }}
                >
                  Continue
                </button>
                {/* Spacer below Continue button, above Sign in with SSO */}
                <div className="h-14 shrink-0" style={{ minHeight: '3.5rem' }} aria-hidden="true" />
              </>
            )}

            {/* Step 2: Password + Sign in (login only) - same box + spacing as step 1 to avoid layout jump */}
            {showPasswordStep && (
              <>
                <div style={{ pointerEvents: 'auto' }}>
                  <div className="flex items-center gap-3 w-full border border-gray-200 rounded-none bg-white px-4 py-3.5 focus-within:border-gray-400 focus-within:outline-none">
                    <Lock className="w-5 h-5 text-gray-400 flex-shrink-0" aria-hidden />
                    <input
                      ref={passwordInputRefCallback}
                      type="password"
                      id="password"
                      name="password"
                      required
                      value={formData.password}
                      onChange={handleChange}
                      onInput={handleInput}
                      className="auth-input flex-1 min-w-0 border-0 bg-transparent outline-none text-base p-0"
                      placeholder="Password"
                      disabled={loading}
                      autoComplete="current-password"
                      data-form-type="other"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-bwignore="true"
                      tabIndex={0}
                      data-no-delay="true"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 rounded-lg font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#909FF7] disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-4 mb-0"
                  style={{ backgroundColor: '#909FF7' }}
                  onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = '#7b8bf5'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#909FF7'; }}
                >
                  {loading ? 'Signing in...' : 'Sign in'}
                </button>
                <div className="h-14 shrink-0" style={{ minHeight: '3.5rem' }} aria-hidden="true" />
              </>
            )}

            {/* Signup fields and submit - all simple line inputs like companyName */}
            {showSignupFields && (
              <>
                <div className="mb-8" style={{ pointerEvents: 'auto' }}>
                  <input
                    ref={emailInputRefCallback}
                    type="email"
                    id="email"
                    name="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    onInput={handleInput}
                    className="auth-input w-full border-0 border-b border-gray-200 bg-transparent py-2 outline-none focus:border-gray-400"
                    placeholder="Email"
                    disabled={loading}
                    autoComplete="email"
                  />
                </div>
                <div className="mb-8" style={{ pointerEvents: 'auto' }}>
                  <input
                    ref={firstNameInputRef}
                    type="text"
                    id="firstName"
                    name="firstName"
                    required
                    value={formData.firstName || ''}
                    onChange={handleChange}
                    onInput={handleInput}
                    className="auth-input w-full border-0 border-b border-gray-200 bg-transparent py-2 outline-none focus:border-gray-400"
                    placeholder="First Name"
                    disabled={loading}
                    autoComplete="given-name"
                  />
                </div>
                <div className="mb-8" style={{ pointerEvents: 'auto' }}>
                  <input
                    ref={lastNameInputRef}
                    type="text"
                    id="lastName"
                    name="lastName"
                    required
                    value={formData.lastName || ''}
                    onChange={handleChange}
                    onInput={handleInput}
                    className="auth-input w-full border-0 border-b border-gray-200 bg-transparent py-2 outline-none focus:border-gray-400"
                    placeholder="Last Name"
                    disabled={loading}
                    autoComplete="family-name"
                  />
                </div>
                <div className="mb-8" style={{ pointerEvents: 'auto' }}>
                  <input
                    ref={companyNameInputRef}
                    type="text"
                    id="companyName"
                    name="companyName"
                    value={formData.companyName || ''}
                    onChange={handleChange}
                    onInput={handleInput}
                    className="auth-input w-full border-0 border-b border-gray-200 bg-transparent py-2 outline-none focus:border-gray-400"
                    placeholder="Company Name"
                    disabled={loading}
                    autoComplete="organization"
                  />
                </div>
                <div className="mb-8" style={{ pointerEvents: 'auto' }}>
                  <input
                    ref={passwordInputRefCallback}
                    type="password"
                    id="password"
                    name="password"
                    required
                    value={formData.password}
                    onChange={handleChange}
                    onInput={handleInput}
                    className="auth-input w-full border-0 border-b border-gray-200 bg-transparent py-2 outline-none focus:border-gray-400"
                    placeholder="Password"
                    disabled={loading}
                    autoComplete="new-password"
                    data-form-type="other"
                    data-lpignore="true"
                  />
                </div>
                <div className="mb-8" style={{ pointerEvents: 'auto' }}>
                  <input
                    ref={confirmPasswordInputRef}
                    type="password"
                    id="confirmPassword"
                    name="confirmPassword"
                    required
                    value={formData.confirmPassword || ''}
                    onChange={handleChange}
                    onInput={handleInput}
                    className="auth-input w-full border-0 border-b border-gray-200 bg-transparent py-2 outline-none focus:border-gray-400"
                    placeholder="Confirm Password"
                    disabled={loading}
                    autoComplete="new-password"
                    data-lpignore="true"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 rounded-lg font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#909FF7] disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-8 mb-14"
                  style={{ backgroundColor: '#909FF7' }}
                  onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = '#7b8bf5'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#909FF7'; }}
                >
                  {loading ? 'Creating Account...' : 'Sign up'}
                </button>
              </>
            )}

            <p className="auth-form-text text-sm text-center mt-4">
              If you are part of a team, please contact your team&apos;s administrator for an invite link.
            </p>

            <div className="text-center pt-10">
              <button
                type="button"
                onClick={toggleMode}
                className="auth-form-text text-sm hover:opacity-80 bg-transparent border-none cursor-pointer"
              >
                {isLoginMode ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Right column: image - hidden on small screens, takes most of view on md+ */}
      <div className="hidden md:flex flex-1 min-w-0 min-h-screen overflow-hidden bg-gray-100 -ml-px">
        <img
          src="/Login-image%202.png"
          alt="Velora"
          className="w-full h-full object-cover object-left min-h-full"
        />
      </div>
    </div>
  );
};

export default Auth;

