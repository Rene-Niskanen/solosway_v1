"use client";

import * as React from "react";
import { ProfileImageUpload } from "./ProfileImageUpload";

interface CompanyLogoUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (file: File) => Promise<void>;
  onRemove?: () => Promise<void>;
  currentLogoUrl?: string;
}

export const CompanyLogoUpload: React.FC<CompanyLogoUploadProps> = ({
  isOpen,
  onClose,
  onSave,
  onRemove,
  currentLogoUrl,
}) => {
  return (
    <ProfileImageUpload
      isOpen={isOpen}
      onClose={onClose}
      onSave={onSave}
      onRemove={onRemove}
      currentImageUrl={currentLogoUrl}
      title="Upload company logo"
      aspectRatio={1} // Square logo, can be adjusted
    />
  );
};
