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
        <div style={{ display: 'flex', alignItems: multiline ? 'flex-start' : 'center', gap: '10px', width: '100%', flexWrap: 'wrap' }}>
          {icon && (
            <div style={{ display: 'flex', alignItems: 'center', marginTop: multiline ? '10px' : 0, flexShrink: 0, color: '#6b7280' }}>
              {icon}
            </div>
          )}
          <div style={{ flex: 1, minWidth: '180px' }}>
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
                  padding: '10px 12px',
                  border: error ? '2px solid #ef4444' : '1px solid #e5e7eb',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                  fontSize: '13px',
                  color: '#1a1a1a',
                  outline: 'none',
                  minHeight: '72px',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  lineHeight: '1.5',
                  boxShadow: error ? '0 0 0 3px rgba(239, 68, 68, 0.1)' : '0 1px 2px rgba(0, 0, 0, 0.05)',
                  transition: 'all 150ms ease',
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
                  padding: '10px 12px',
                  border: error ? '2px solid #ef4444' : '1px solid #e5e7eb',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                  fontSize: '13px',
                  color: '#1a1a1a',
                  outline: 'none',
                  fontFamily: 'inherit',
                  lineHeight: '1.5',
                  boxShadow: error ? '0 0 0 3px rgba(239, 68, 68, 0.1)' : '0 1px 2px rgba(0, 0, 0, 0.05)',
                  transition: 'all 150ms ease',
                }}
              />
            )}
            {error && (
              <div style={{
                fontSize: '12px',
                color: '#ef4444',
                marginTop: '6px',
                paddingLeft: '0',
                lineHeight: '1.4',
                fontWeight: 500,
              }}>
                {error}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0, marginTop: multiline ? '8px' : '0', alignItems: 'center' }}>
            <button
              onClick={handleSave}
              disabled={isSaving}
              style={{
                padding: '8px 16px',
                height: '34px',
                backgroundColor: isSaving ? '#d1d5db' : '#3b82f6',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: isSaving ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                opacity: isSaving ? 0.7 : 1,
                transition: 'all 150ms ease',
              }}
              onMouseEnter={(e) => {
                if (!isSaving) {
                  e.currentTarget.style.backgroundColor = '#2563eb';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = isSaving ? '#d1d5db' : '#3b82f6';
              }}
              title="Save"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Save</span>
                </>
              )}
            </button>
            <button
              onClick={handleCancel}
              disabled={isSaving}
              style={{
                padding: '8px 12px',
                height: '34px',
                backgroundColor: 'transparent',
                color: '#6b7280',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: isSaving ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: isSaving ? 0.5 : 1,
                transition: 'all 150ms ease',
              }}
              onMouseEnter={(e) => {
                if (!isSaving) {
                  e.currentTarget.style.backgroundColor = '#f3f4f6';
                  e.currentTarget.style.borderColor = '#d1d5db';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.borderColor = '#e5e7eb';
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
        gap: '12px',
        padding: '10px 12px',
        cursor: 'pointer',
        borderRadius: '8px',
        border: '1px solid transparent',
        backgroundColor: isHovered ? '#f9fafb' : 'transparent',
        transition: 'all 150ms ease',
      }}
    >
      {icon && (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: '#9ca3af' }}>
          {icon}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {label && (
          <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '2px', fontWeight: 500, lineHeight: '1.4' }}>
            {label}
          </div>
        )}
        <div style={{
          fontSize: '13px',
          color: (value && value.trim()) ? '#1a1a1a' : '#9ca3af',
          whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
          overflow: multiline ? 'visible' : 'hidden',
          textOverflow: multiline ? 'clip' : 'ellipsis',
          fontWeight: 450,
          lineHeight: '1.5',
          minHeight: '20px',
        }}>
          {(value && value.trim()) ? value : (placeholder || 'Click to edit')}
        </div>
      </div>
      <div
        style={{
          opacity: isHovered || showSuccess ? 1 : 0,
          transition: 'opacity 150ms ease',
          flexShrink: 0,
        }}
      >
        {showSuccess ? (
          <Check className="w-4 h-4" style={{ color: '#22c55e' }} />
        ) : (
          <Edit2 className="w-3.5 h-3.5" style={{ color: '#9ca3af' }} />
        )}
      </div>
    </div>
  );
};
