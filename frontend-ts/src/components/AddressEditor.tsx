"use client";

import * as React from "react";
import { MapPin } from "lucide-react";
import { EnhancedEditableField } from "./EnhancedEditableField";
import { validateAddress } from "@/utils/profileValidation";

interface AddressEditorProps {
  value: string;
  onSave: (value: string) => Promise<void>;
  placeholder?: string;
}

/**
 * AddressEditor component
 * Simple address input with multiline support
 * Phase 1: No autocomplete (will be added in Phase 4)
 */
export const AddressEditor: React.FC<AddressEditorProps> = ({
  value,
  onSave,
  placeholder = "Enter your address",
}) => {
  return (
    <EnhancedEditableField
      value={value}
      onSave={onSave}
      validate={validateAddress}
      placeholder={placeholder}
      icon={<MapPin className="w-4 h-4" />}
      multiline
    />
  );
};
