"use client";

import * as React from "react";
import { X, Home } from "lucide-react";
import { PropertyData } from './PropertyResultsDisplay';

export interface PropertyAttachmentData {
  id: string;
  propertyId: string | number;
  address: string;
  imageUrl: string;
  property: PropertyData; // Full property object for reference
}

export interface PropertyAttachmentProps {
  attachment: PropertyAttachmentData;
  onRemove: (id: string) => void;
  onPreview?: (attachment: PropertyAttachmentData) => void;
}

export const PropertyAttachment: React.FC<PropertyAttachmentProps> = ({
  attachment,
  onRemove,
  onPreview
}) => {
  const formatAddress = (address: string): string => {
    // Extract short address (first part before comma, or first 30 chars)
    const parts = address.split(',');
    const shortAddress = parts[0] || address;
    if (shortAddress.length > 30) {
      return shortAddress.substring(0, 27) + '...';
    }
    return shortAddress;
  };

  const handleClick = (e: React.MouseEvent) => {
    // Don't trigger if clicking the remove button
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }

    if (onPreview) {
      onPreview(attachment);
    }
  };

  const imageUrl = attachment.imageUrl || attachment.property.image || attachment.property.primary_image_url;

  return (
    <div
      className="relative bg-white rounded-lg border border-gray-200 shadow-sm cursor-pointer hover:border-gray-300 hover:shadow-md transition-all duration-100 overflow-hidden"
      style={{ 
        width: '120px',
        height: '100px',
        display: 'inline-block',
        flexShrink: 0,
        padding: 0,
        margin: 0,
      }}
      onClick={handleClick}
      title={`Click to view ${attachment.address}`}
    >
      {/* Image Thumbnail */}
      <div className="relative w-full h-16 overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={attachment.address}
            className="w-full h-full object-cover"
            style={{
              display: 'block',
              padding: 0,
              margin: 0,
              width: '100%',
              height: '100%',
            }}
            onError={(e) => {
              e.currentTarget.src = 'https://via.placeholder.com/120x64/94a3b8/ffffff?text=Property';
            }}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
            <Home className="w-6 h-6 text-slate-400" />
          </div>
        )}
      </div>
      
      {/* Address Title */}
      <div className="px-2 py-1 h-8 flex items-center justify-center gap-1.5 overflow-hidden">
        <Home className="w-3 h-3 text-gray-600 flex-shrink-0" strokeWidth={2} />
        <span className="text-[11px] text-gray-900 font-medium truncate text-center">
          {formatAddress(attachment.address)}
        </span>
      </div>
      
      {/* Remove Button - Top right corner */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(attachment.id);
        }}
        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center flex-shrink-0 hover:bg-black transition-colors"
        title="Remove property"
      >
        <X className="w-3 h-3 text-white" strokeWidth={2.5} />
      </button>
    </div>
  );
};

