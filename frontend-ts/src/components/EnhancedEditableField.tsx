"use client";

import * as React from "react";
import { Edit2, Save, X, Check, Loader2 } from "lucide-react";

interface EnhancedEditableFieldProps {
  value: string;
  onSave: (value: string) => Promise<void>;
  validate?: (value: string) => { isValid: boolean; error?: string };
  placeholder?: string;
  type?: 'text' | 'email' | 'tel' | 'textarea';
  required?: boolean;
  label?: string;
  icon?: React.ReactNode;
  multiline?: boolean;
}

export const EnhancedEditableField: React.FC<EnhancedEditableFieldProps> = ({
  value,
  onSave,
  validate,
  placeholder,
  type = 'text',
  required = false,
  label,
  icon,
  multiline = false,
}) => {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(() => value || '');
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showSuccess, setShowSuccess] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  // Use a ref to store the value when entering edit mode to avoid async state issues
  const editValueRef = React.useRef<string>(value || '');

  // Sync editValue with value prop when not editing, and initialize on mount
  React.useEffect(() => {
    const newValue = value || '';
    if (!isEditing) {
      // Only update if the value actually changed to avoid unnecessary re-renders
      if (editValue !== newValue) {
        setEditValue(newValue);
        editValueRef.current = String(newValue);
      }
    } else {
      // Even when editing, update the ref if value prop changes externally
      editValueRef.current = String(newValue);
    }
  }, [value, isEditing, editValue]);
  
  // Update ref when editValue changes (for when user is typing)
  React.useEffect(() => {
    if (editValue !== null && editValue !== undefined) {
      editValueRef.current = String(editValue);
    }
  }, [editValue]);

  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      // Small delay to ensure the input is fully rendered
      const timeoutId = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          // Only select if there's actual text, otherwise just focus
          if (inputRef.current instanceof HTMLInputElement || inputRef.current instanceof HTMLTextAreaElement) {
            const hasText = editValue && editValue.length > 0;
            if (hasText) {
              inputRef.current.select();
            } else {
              // Just place cursor at the end
              const length = inputRef.current.value.length;
              inputRef.current.setSelectionRange(length, length);
            }
          }
        }
      }, 10);
      return () => clearTimeout(timeoutId);
    }
  }, [isEditing, editValue]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Ensure editValue is set to the current value before entering edit mode
    // Convert to string to ensure it's always a valid value
    const currentValue = value ? String(value) : '';
    // Use functional update to ensure we have the latest value
    setEditValue(currentValue);
    setIsEditing(true);
    setError(null);
    setShowSuccess(false);
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
    setError(null);
    setShowSuccess(false);
  };

  const handleSave = async () => {
    const trimmedValue = (editValue || '').trim();

    // Check required field
    if (required && !trimmedValue) {
      setError('This field is required');
      return;
    }

    // Run validation if provided
    if (validate) {
      const validation = validate(trimmedValue);
      if (!validation.isValid) {
        setError(validation.error || 'Invalid value');
        return;
      }
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave(trimmedValue);
      // Only exit edit mode if save was successful
      setIsEditing(false);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 1000);
    } catch (err) {
      // Show error but keep edit mode open so user can fix it
      const errorMessage = err instanceof Error ? err.message : 'Failed to save. Please try again.';
      setError(errorMessage);
      console.error('Save error:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  if (isEditing) {
    // Ensure we always have a valid string value for the input
    // Use ref first (most up-to-date), then editValue state, then value prop
    // Check for null/undefined explicitly, not falsy values (empty string is valid)
    let displayValue = '';
    if (editValueRef.current !== null && editValueRef.current !== undefined) {
      displayValue = String(editValueRef.current);
    } else if (editValue !== null && editValue !== undefined) {
      displayValue = String(editValue);
    } else if (value !== null && value !== undefined) {
      displayValue = String(value);
    }
    
    return (
      <div style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: multiline ? 'flex-start' : 'center', gap: '8px', width: '100%', flexWrap: 'wrap' }}>
          {icon && (
            <div style={{ marginTop: multiline ? '8px' : '0', flexShrink: 0 }}>
              {icon}
            </div>
          )}
          <div style={{ flex: 1, minWidth: '200px' }}>
            {multiline ? (
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                value={displayValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                  // Don't auto-close on blur, let user explicitly save or cancel
                }}
                placeholder={placeholder}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  border: error ? '2px solid #EA4335' : '1px solid #DADCE0',
                  borderRadius: '8px',
                  backgroundColor: '#FFFFFF',
                  fontSize: '14px',
                  color: '#202124',
                  outline: 'none',
                  minHeight: '80px',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  lineHeight: '1.5',
                  boxShadow: error ? '0 0 0 3px rgba(234, 67, 53, 0.1)' : '0 1px 3px rgba(0, 0, 0, 0.08)',
                  transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              />
            ) : (
              <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                type={type}
                value={displayValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                  // Don't auto-close on blur
                }}
                placeholder={placeholder}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  border: error ? '2px solid #EA4335' : '1px solid #DADCE0',
                  borderRadius: '8px',
                  backgroundColor: '#FFFFFF',
                  fontSize: '14px',
                  color: '#202124',
                  outline: 'none',
                  fontFamily: 'inherit',
                  lineHeight: '1.5',
                  boxShadow: error ? '0 0 0 3px rgba(234, 67, 53, 0.1)' : '0 1px 3px rgba(0, 0, 0, 0.08)',
                  transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              />
            )}
            {error && (
              <div style={{
                fontSize: '11px',
                color: '#EA4335',
                marginTop: '6px',
                paddingLeft: '0',
                lineHeight: '1.4',
              }}>
                {error}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0, marginTop: multiline ? '8px' : '0', alignItems: 'center' }}>
            <button
              onClick={handleSave}
              disabled={isSaving}
              style={{
                padding: '10px 24px',
                height: '36px',
                backgroundColor: isSaving ? '#DADCE0' : '#1A73E8',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '20px',
                fontSize: '14px',
                fontWeight: 500,
                cursor: isSaving ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                opacity: isSaving ? 0.6 : 1,
                boxShadow: isSaving ? 'none' : '0 1px 2px rgba(26, 115, 232, 0.15)',
                transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}
              onMouseEnter={(e) => {
                if (!isSaving) {
                  e.currentTarget.style.backgroundColor = '#1765CC';
                  e.currentTarget.style.boxShadow = '0 2px 4px rgba(26, 115, 232, 0.2)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = isSaving ? '#DADCE0' : '#1A73E8';
                e.currentTarget.style.boxShadow = isSaving ? 'none' : '0 1px 2px rgba(26, 115, 232, 0.15)';
              }}
              title="Save"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save</span>
                </>
              )}
            </button>
            <button
              onClick={handleCancel}
              disabled={isSaving}
              style={{
                padding: '10px 24px',
                height: '36px',
                backgroundColor: 'transparent',
                color: '#5F6368',
                border: '1px solid #DADCE0',
                borderRadius: '20px',
                fontSize: '14px',
                fontWeight: 500,
                cursor: isSaving ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                opacity: isSaving ? 0.5 : 1,
                transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}
              onMouseEnter={(e) => {
                if (!isSaving) {
                  e.currentTarget.style.backgroundColor = '#F1F3F4';
                  e.currentTarget.style.borderColor = '#BDC1C6';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.borderColor = '#DADCE0';
              }}
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '12px 14px',
        cursor: 'pointer',
        borderRadius: '8px',
        border: '1px solid transparent',
        backgroundColor: isHovered ? '#F1F3F4' : 'transparent',
        transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: isHovered ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
      }}
    >
      {icon && (
        <div style={{ flexShrink: 0, color: '#5F6368' }}>
          {icon}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {label && (
          <div style={{ fontSize: '11px', color: '#5F6368', marginBottom: '4px', fontWeight: 500, lineHeight: '1.4' }}>
            {label}
          </div>
        )}
        <div style={{
          fontSize: '14px',
          color: (value && value.trim()) ? '#202124' : '#9AA0A6',
          whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
          overflow: multiline ? 'visible' : 'hidden',
          textOverflow: multiline ? 'clip' : 'ellipsis',
          fontWeight: 400,
          lineHeight: '1.5',
          minHeight: '20px',
        }}>
          {(value && value.trim()) ? value : (placeholder || 'Click to edit')}
        </div>
      </div>
      <div
        style={{
          opacity: isHovered || showSuccess ? 1 : 0,
          transition: 'opacity 200ms cubic-bezier(0.4, 0, 0.2, 1)',
          flexShrink: 0,
        }}
      >
        {showSuccess ? (
          <Check className="w-4 h-4" style={{ color: '#34A853' }} />
        ) : (
          <Edit2 className="w-4 h-4" style={{ color: isHovered ? '#202124' : '#5F6368' }} />
        )}
      </div>
    </div>
  );
};
