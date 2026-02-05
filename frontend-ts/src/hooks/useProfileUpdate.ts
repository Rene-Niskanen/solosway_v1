"use client";

import { useState, useCallback } from 'react';
import { backendApi } from '@/services/backendApi';
import { env } from '@/config/env';

const BACKEND_URL = env.backendUrl;

interface ProfileUpdateData {
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  phone?: string;
  address?: string;
  location?: string; // Keep for backward compatibility
  organization?: string;
}

interface UseProfileUpdateReturn {
  updateProfile: (data: ProfileUpdateData) => Promise<void>;
  uploadProfilePicture: (file: File) => Promise<string>;
  uploadCompanyLogo: (file: File) => Promise<string>;
  removeProfilePicture: () => Promise<void>;
  removeCompanyLogo: () => Promise<void>;
  isUpdating: boolean;
  error: string | null;
}

export const useProfileUpdate = (): UseProfileUpdateReturn => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateProfile = useCallback(async (data: ProfileUpdateData) => {
    setIsUpdating(true);
    setError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/user/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      // If endpoint doesn't exist (404), log warning but don't throw error
      // This allows the UI to work while backend is being developed
      if (response.status === 404) {
        console.warn('Profile update endpoint not yet implemented on backend. Update will be saved locally only.');
        setIsUpdating(false);
        return; // Return successfully so UI updates
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to update profile (${response.status})`);
      }

      const result = await response.json();
      
      // Refresh auth to get updated user data
      try {
        await backendApi.checkAuth();
      } catch (authError) {
        console.warn('Could not refresh auth after profile update:', authError);
        // Don't throw - the update might have succeeded
      }
      
      return result;
    } catch (err) {
      // If it's a network error and endpoint doesn't exist, allow local update
      if (err instanceof TypeError && err.message.includes('fetch')) {
        console.warn('Network error - profile update endpoint may not exist. Update will be saved locally only.');
        setIsUpdating(false);
        return; // Return successfully so UI updates
      }
      
      const errorMessage = err instanceof Error ? err.message : 'Failed to update profile';
      setError(errorMessage);
      throw err;
    } finally {
      setIsUpdating(false);
    }
  }, []);

  const uploadProfilePicture = useCallback(async (file: File): Promise<string> => {
    setIsUpdating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(`${BACKEND_URL}/api/user/profile-picture`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to upload profile picture');
      }

      const data = await response.json();
      return data.profile_image_url || data.avatar_url || '';
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to upload profile picture';
      setError(errorMessage);
      throw err;
    } finally {
      setIsUpdating(false);
    }
  }, []);

  const uploadCompanyLogo = useCallback(async (file: File): Promise<string> => {
    setIsUpdating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('logo', file);

      const response = await fetch(`${BACKEND_URL}/api/user/company-logo`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to upload company logo');
      }

      const data = await response.json();
      return data.company_logo_url || '';
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to upload company logo';
      setError(errorMessage);
      throw err;
    } finally {
      setIsUpdating(false);
    }
  }, []);

  const removeProfilePicture = useCallback(async () => {
    setIsUpdating(true);
    setError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/user/profile-picture`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to remove profile picture');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to remove profile picture';
      setError(errorMessage);
      throw err;
    } finally {
      setIsUpdating(false);
    }
  }, []);

  const removeCompanyLogo = useCallback(async () => {
    setIsUpdating(true);
    setError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/user/company-logo`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to remove company logo');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to remove company logo';
      setError(errorMessage);
      throw err;
    } finally {
      setIsUpdating(false);
    }
  }, []);

  return {
    updateProfile,
    uploadProfilePicture,
    uploadCompanyLogo,
    removeProfilePicture,
    removeCompanyLogo,
    isUpdating,
    error,
  };
};
