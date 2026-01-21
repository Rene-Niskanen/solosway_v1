/**
 * Profile validation utilities
 * Validates user profile fields according to design system requirements
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates email address
 */
export const validateEmail = (email: string): ValidationResult => {
  if (!email || email.trim() === '') {
    return { isValid: false, error: 'Email is required' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { isValid: false, error: 'Please enter a valid email address' };
  }

  return { isValid: true };
};

/**
 * Validates phone number (international format)
 */
export const validatePhone = (phone: string): ValidationResult => {
  if (!phone || phone.trim() === '') {
    return { isValid: true }; // Phone is optional
  }

  // Allow international format: +, digits, spaces, dashes, parentheses
  const phoneRegex = /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/;
  if (!phoneRegex.test(phone.replace(/\s/g, ''))) {
    return { isValid: false, error: 'Please enter a valid phone number' };
  }

  return { isValid: true };
};

/**
 * Validates name (first or last name)
 */
export const validateName = (name: string, fieldName: string = 'Name'): ValidationResult => {
  if (!name || name.trim() === '') {
    return { isValid: false, error: `${fieldName} is required` };
  }

  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { isValid: false, error: `${fieldName} must be at least 2 characters` };
  }

  if (trimmed.length > 50) {
    return { isValid: false, error: `${fieldName} must be less than 50 characters` };
  }

  return { isValid: true };
};

/**
 * Validates full name (first and last name combined)
 */
export const validateFullName = (firstName: string, lastName: string): ValidationResult => {
  const firstResult = validateName(firstName, 'First name');
  if (!firstResult.isValid) {
    return firstResult;
  }

  const lastResult = validateName(lastName, 'Last name');
  if (!lastResult.isValid) {
    return lastResult;
  }

  return { isValid: true };
};

/**
 * Validates address (optional but recommended)
 */
export const validateAddress = (address: string): ValidationResult => {
  // Address is optional, but if provided, should have some content
  if (address && address.trim().length < 5) {
    return { isValid: false, error: 'Address must be at least 5 characters' };
  }

  return { isValid: true };
};

/**
 * Validates title/role
 */
export const validateTitle = (title: string): ValidationResult => {
  if (!title || title.trim() === '') {
    return { isValid: false, error: 'Title is required' };
  }

  if (title.trim().length > 100) {
    return { isValid: false, error: 'Title must be less than 100 characters' };
  }

  return { isValid: true };
};

/**
 * Validates organization name
 */
export const validateOrganization = (organization: string): ValidationResult => {
  if (!organization || organization.trim() === '') {
    return { isValid: false, error: 'Organization is required' };
  }

  if (organization.trim().length > 100) {
    return { isValid: false, error: 'Organization must be less than 100 characters' };
  }

  return { isValid: true };
};

/**
 * Validates image file
 */
export const validateImageFile = (file: File): ValidationResult => {
  const maxSize = 5 * 1024 * 1024; // 5MB
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  if (!allowedTypes.includes(file.type)) {
    return { isValid: false, error: 'Image must be in JPG, PNG, or WebP format' };
  }

  if (file.size > maxSize) {
    return { isValid: false, error: 'Image must be under 5MB' };
  }

  return { isValid: true };
};

/**
 * Validates image dimensions (for profile picture)
 */
export const validateImageDimensions = (
  file: File,
  minWidth: number = 200,
  minHeight: number = 200
): Promise<ValidationResult> => {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (img.width < minWidth || img.height < minHeight) {
        resolve({
          isValid: false,
          error: `Image must be at least ${minWidth}×${minHeight} pixels`,
        });
      } else {
        resolve({ isValid: true });
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ isValid: false, error: 'Invalid image file' });
    };

    img.src = objectUrl;
  });
};
