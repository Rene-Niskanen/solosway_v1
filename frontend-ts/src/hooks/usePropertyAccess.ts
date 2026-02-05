import { useState, useEffect, useCallback } from 'react';
import { backendApi } from '@/services/backendApi';

export type AccessLevel = 'viewer' | 'editor' | 'owner' | null;

interface PropertyAccess {
  access_level: 'viewer' | 'editor' | 'owner';
  status: 'pending' | 'accepted' | 'declined';
  user_email: string;
}

/**
 * Hook to get the current user's access level for a property
 * Returns 'owner' if user owns the property (same business_id), 
 * or the access level from PropertyAccess table if shared
 */
export const usePropertyAccess = (propertyId: string | null | undefined) => {
  const [accessLevel, setAccessLevel] = useState<AccessLevel>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Get current user's email
  useEffect(() => {
    const fetchUserEmail = async () => {
      try {
        const authResult = await backendApi.checkAuth();
        if (authResult.success && authResult.data?.user?.email) {
          setUserEmail(authResult.data.user.email.toLowerCase());
        }
      } catch (error) {
        console.error('Error fetching user email:', error);
      }
    };
    fetchUserEmail();
  }, []);

  // Get access level for property
  useEffect(() => {
    if (!propertyId || !userEmail) {
      setIsLoading(false);
      return;
    }

    const fetchAccessLevel = async () => {
      try {
        setIsLoading(true);
        // Get property access list
        const accessResponse = await backendApi.getPropertyAccess(propertyId);
        
        if (accessResponse.success && accessResponse.data) {
          const accessList = Array.isArray(accessResponse.data) 
            ? accessResponse.data 
            : accessResponse.data.access_list || [];
          
          // Find current user's access
          const userAccess = accessList.find(
            (access: PropertyAccess) => 
              access.user_email.toLowerCase() === userEmail &&
              access.status === 'accepted'
          );
          
          if (userAccess) {
            setAccessLevel(userAccess.access_level);
          } else {
            // If not in access list, check if user owns the property (same business)
            // For now, assume owner if not in shared access list
            // This will be refined when backend implements proper ownership check
            setAccessLevel('owner');
          }
        } else {
          // Default to owner if access check fails (fallback)
          setAccessLevel('owner');
        }
      } catch (error) {
        console.error('Error fetching property access:', error);
        // Default to owner on error (fallback - allows access)
        setAccessLevel('owner');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAccessLevel();
  }, [propertyId, userEmail]);

  // Helper function to check if user can perform action
  const canEdit = useCallback(() => {
    return accessLevel === 'editor' || accessLevel === 'owner';
  }, [accessLevel]);

  const canDelete = useCallback(() => {
    return accessLevel === 'editor' || accessLevel === 'owner';
  }, [accessLevel]);

  const canUpload = useCallback(() => {
    return accessLevel === 'editor' || accessLevel === 'owner';
  }, [accessLevel]);

  return {
    accessLevel,
    isLoading,
    canEdit,
    canDelete,
    canUpload,
    isViewer: accessLevel === 'viewer',
    isEditor: accessLevel === 'editor',
    isOwner: accessLevel === 'owner'
  };
};
