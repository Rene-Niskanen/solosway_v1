import React, { useState, useRef, useCallback, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
    <div 
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(200, 210, 220, 0.8) 0%, rgba(100, 120, 140, 0.9) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)'
      }}
    >
      {/* Content Container - centered minimal layout */}
      <div className="relative z-10 w-full max-w-md px-6 sm:px-8">
        {/* Velora Logo */}
        <div className="flex justify-center mb-12">
          <img 
            src="/velora-dash-logo.png" 
            alt="Velora Logo"
            className="w-20 h-20 sm:w-24 sm:h-24 object-contain"
            style={{ filter: 'brightness(0) invert(1)' }}
          />
        </div>

        {/* Form */}
          <form 
          onSubmit={handleSubmit} 
          className="space-y-6" 
          autoComplete="off" 
          data-lpignore="true"
          data-1p-ignore="true"
          data-bwignore="true"
          data-form-type="other"
          onClick={(e) => {
            // Prevent form clicks from interfering with input focus
            if ((e.target as HTMLElement).tagName === 'INPUT') {
              return;
            }
          }}
          style={{ pointerEvents: 'auto' }}
        >
          <style>{`
            input::placeholder {
              color: rgba(243, 244, 246, 0.85) !important;
              opacity: 1;
            }
            input:-webkit-input-placeholder {
              color: rgba(243, 244, 246, 0.85) !important;
            }
            input:-moz-placeholder {
              color: rgba(243, 244, 246, 0.85) !important;
              opacity: 1;
            }
            input::-moz-placeholder {
              color: rgba(243, 244, 246, 0.85) !important;
              opacity: 1;
            }
            input:-ms-input-placeholder {
              color: rgba(243, 244, 246, 0.85) !important;
            }
          `}</style>
          {/* Error Message */}
          {error && (
            <div className="text-red-300 px-4 py-3 rounded text-sm text-center" style={{ fontFamily: '"Inter", sans-serif' }}>
              {error}
            </div>
          )}

          {/* Email Field */}
          <div style={{ pointerEvents: 'auto' }}>
            <input
              ref={emailInputRefCallback}
              type="email"
              id="email"
              name="email"
              required
              value={formData.email}
              onChange={handleChange}
              onInput={handleInput}
              className="w-full py-3 bg-transparent border-0 border-b outline-none focus:outline-none relative z-20"
              style={{ 
                transition: 'none !important', 
                WebkitTapHighlightColor: 'transparent',
                pointerEvents: 'auto',
                touchAction: 'manipulation',
                cursor: 'text',
                animation: 'none',
                transform: 'translateZ(0)',
                backfaceVisibility: 'hidden',
                borderBottom: '1.5px solid rgba(229, 231, 235, 0.7)',
                color: '#F3F4F6',
                fontFamily: '"Inter", sans-serif',
                fontSize: '16px',
                paddingLeft: '0',
                paddingRight: '0',
                backgroundColor: 'transparent',
                borderRadius: '4px',
                paddingTop: '12px',
                paddingBottom: '12px'
              }}
              placeholder="Email"
              disabled={loading}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              tabIndex={0}
              data-no-delay="true"
              onFocus={(e) => {
                e.target.style.borderBottomColor = 'rgba(229, 231, 235, 0.95)';
              }}
              onBlur={(e) => {
                e.target.style.borderBottomColor = 'rgba(229, 231, 235, 0.7)';
              }}
            />
          </div>

          {/* Password Field */}
          <div style={{ pointerEvents: 'auto' }}>
            <input
              ref={passwordInputRefCallback}
              type="password"
              id="password"
              name="password"
              required
              value={formData.password}
              onChange={handleChange}
              onInput={handleInput}
              className="w-full py-3 bg-transparent border-0 border-b outline-none focus:outline-none relative z-20"
              style={{ 
                transition: 'none !important', 
                WebkitTapHighlightColor: 'transparent',
                pointerEvents: 'auto',
                touchAction: 'manipulation',
                cursor: 'text',
                animation: 'none',
                transform: 'translateZ(0)',
                backfaceVisibility: 'hidden',
                borderBottom: '1.5px solid rgba(229, 231, 235, 0.7)',
                color: '#F3F4F6',
                fontFamily: '"Inter", sans-serif',
                fontSize: '16px',
                paddingLeft: '0',
                paddingRight: '0',
                backgroundColor: 'transparent',
                borderRadius: '4px',
                paddingTop: '12px',
                paddingBottom: '12px'
              }}
              placeholder="Password"
              disabled={loading}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              data-form-type="other"
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              tabIndex={0}
              data-no-delay="true"
              onFocus={(e) => {
                e.target.style.borderBottomColor = 'rgba(229, 231, 235, 0.95)';
              }}
              onBlur={(e) => {
                e.target.style.borderBottomColor = 'rgba(229, 231, 235, 0.7)';
              }}
            />
          </div>

          {/* Login Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 rounded-md font-medium focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed mt-8"
            style={{ 
              transition: 'none',
              background: 'transparent',
              border: '1px solid rgba(229, 231, 235, 0.5)',
              color: '#E5E7EB',
              fontFamily: '"Inter", sans-serif',
              fontSize: '16px'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.5)';
            }}
          >
            {loading ? (isLoginMode ? 'Signing in...' : 'Creating Account...') : 'Login'}
          </button>

          {/* Toggle Link */}
          <div className="text-center pt-6">
            <button
              type="button"
              onClick={toggleMode}
              style={{ 
                fontFamily: '"Inter", sans-serif',
                fontSize: '14px',
                color: 'rgba(229, 231, 235, 0.7)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                transition: 'none'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'rgba(229, 231, 235, 0.9)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'rgba(229, 231, 235, 0.7)';
              }}
            >
              {isLoginMode ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Auth;

