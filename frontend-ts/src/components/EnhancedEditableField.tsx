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
  /** Background color for the container when not editing (e.g. #F3F1EF for visibility on light backgrounds). */
  containerBackgroundColor?: string;
  /** When true, no hover animation and no pencil icon (static display). */
  staticDisplay?: boolean;
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
  containerBackgroundColor,
  staticDisplay = false,
}) => {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(() => value || '');
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showSuccess, setShowSuccess] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  // Use a ref to store the value when entering edit mode to avoid async state issues
  const editValueRef = React.useRef<string>(value || '');

  // Sync editValue with value prop when not editing; when editing, never overwrite ref so user typing is preserved
  React.useEffect(() => {
    const newValue = value || '';
    if (!isEditing) {
      if (editValue !== newValue) {
        setEditValue(newValue);
        editValueRef.current = String(newValue);
      }
    }
    // When isEditing, do NOT set editValueRef here — the effect below keeps ref in sync with editValue (user typing)
  }, [value, isEditing, editValue]);

  // Keep ref in sync with editValue so the input always shows what the user is typing
  React.useEffect(() => {
    if (editValue !== null && editValue !== undefined) {
      editValueRef.current = String(editValue);
    }
  }, [editValue]);

  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      // Focus input when entering edit mode so user can type immediately (including in Profile staticDisplay)
      const timeoutId = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          if (inputRef.current instanceof HTMLInputElement || inputRef.current instanceof HTMLTextAreaElement) {
            const hasText = editValue && editValue.length > 0;
            if (hasText) {
              inputRef.current.select();
            } else {
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
    const currentValue = value ? String(value) : '';
    setEditValue(currentValue);
    editValueRef.current = currentValue;
    setError(null);
    setShowSuccess(false);
    setIsEditing(true);
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
    // Controlled by editValue so typing always works (ref is only for initial sync when entering edit mode)
    const inputValue = editValue !== null && editValue !== undefined ? String(editValue) : value != null ? String(value) : '';

    return (
      <div
        style={{ width: '100%', minWidth: 200 }}
        onClick={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
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
                value={inputValue}
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
                value={inputValue}
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
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleSave();
              }}
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
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>Saving…</span>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>✓ Save</span>
              )}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleCancel();
              }}
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
              ×
            </button>
          </div>
        </div>
      </div>
    );
  }

  const [isHovered, setIsHovered] = React.useState(false);

  const triggerEdit = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if ('button' in e && e.button !== 0) return;
    if ('key' in e && e.key !== 'Enter' && e.key !== ' ') return;
    handleClick(e as React.MouseEvent);
  };

  const displayStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    cursor: 'pointer',
    borderRadius: '8px',
    border: '1px solid transparent',
    width: '100%',
    textAlign: 'left',
    font: 'inherit',
    appearance: 'none',
    backgroundColor: staticDisplay ? (containerBackgroundColor ?? 'transparent') : (isHovered ? '#f9fafb' : (containerBackgroundColor ?? 'transparent')),
    transition: staticDisplay ? 'none' : 'all 150ms ease',
  };

  // Use div with role="button" instead of <button> to avoid any native form/link behavior
  // that could cause navigation or blank screen when used inside complex layouts (e.g. Settings > Profile).
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={placeholder || 'Edit'}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        triggerEdit(e);
      }}
      onPointerDownCapture={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          triggerEdit(e);
        }
      }}
      onMouseEnter={staticDisplay ? undefined : () => setIsHovered(true)}
      onMouseLeave={staticDisplay ? undefined : () => setIsHovered(false)}
      style={displayStyles}
      className="enhanced-editable-field-trigger"
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
      {!staticDisplay && (
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
      )}
      {staticDisplay && showSuccess && (
        <div style={{ flexShrink: 0 }}>
          <Check className="w-4 h-4" style={{ color: '#22c55e' }} />
        </div>
      )}
    </div>
  );
};
