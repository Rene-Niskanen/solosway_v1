"use client";

import * as React from "react";
import { Plus, FileCheckCorner, Clock, User } from "lucide-react";

export interface LastFile {
  type: 'document' | 'map' | 'floorplan' | 'image';
  url?: string;
  thumbnail?: string;
}

export interface RecentProjectCardProps {
  type: 'new' | 'existing' | 'blank';
  projectType?: string;
  propertyAddress?: string;
  lastFile?: LastFile;
  documentCount?: number;
  lastOpened?: string;
  userAvatar?: string;
  cardWidth?: number; // Responsive card width
}

export const RecentProjectCard: React.FC<RecentProjectCardProps> = ({
  type,
  projectType,
  propertyAddress,
  lastFile,
  documentCount,
  lastOpened,
  userAvatar,
  cardWidth = 200
}) => {
  // Calculate proportional dimensions based on card width
  const cardHeight = cardWidth * 1.28; // Maintain 200/256 aspect ratio
  // Keep font sizes slightly smaller relative to card size for neat appearance, but readable
  const fontSize = {
    small: `${Math.max(8, cardWidth * 0.042)}px`, // ~10px at 240px, increased for better readability
    medium: `${Math.max(10, cardWidth * 0.048)}px`, // ~11.5px at 240px, increased for better readability
    large: `${Math.max(12, cardWidth * 0.048)}px` // ~11.5px at 240px, increased for better readability
  };
  const iconSize = {
    small: Math.max(10, cardWidth * 0.1), // 20px at 200px
    medium: Math.max(12, cardWidth * 0.125), // 25px at 200px
    large: Math.max(18, cardWidth * 0.15) // 30px at 200px
  };
  const padding = Math.max(8, cardWidth * 0.1); // 20px at 200px
  const gap = Math.max(4, cardWidth * 0.02); // 4px at 200px
  // Render preview image based on last file type
  const renderPreviewImage = () => {
    const previewFontSize = `${Math.max(8, cardWidth * 0.04)}px`;
    
    if (!lastFile) {
      return (
        <div className="w-full h-full bg-gray-100 flex items-center justify-center">
          <div className="text-gray-400" style={{ fontSize: previewFontSize }}>No preview</div>
        </div>
      );
    }

    // If we have a thumbnail URL, use it
    if (lastFile.thumbnail) {
      return (
        <div className="w-full h-full overflow-hidden" style={{ margin: 0, padding: 0 }}>
          <img 
            src={lastFile.thumbnail} 
            alt="Project preview"
            className="w-full h-full object-cover"
            style={{ display: 'block', margin: 0, padding: 0 }}
            onError={(e) => {
              e.currentTarget.src = '/placeholder.svg';
            }}
          />
        </div>
      );
    }

    // Otherwise, render based on file type
    switch (lastFile.type) {
      case 'map':
        return (
          <div className="w-full h-full bg-blue-50 flex items-center justify-center">
            <div className="text-blue-400 font-medium" style={{ fontSize: previewFontSize }}>Map View</div>
          </div>
        );
      case 'floorplan':
        return (
          <div className="w-full h-full bg-gray-50 flex items-center justify-center">
            <div className="text-gray-500 font-medium" style={{ fontSize: previewFontSize }}>Floor Plan</div>
          </div>
        );
      case 'document':
        return (
          <div className="w-full h-full bg-white flex flex-col items-center justify-center relative overflow-hidden">
            {/* Document preview representation */}
            <div className="w-full h-full bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col items-center justify-center" style={{ padding: `${Math.max(4, cardWidth * 0.06)}px` }}>
              {/* Document icon */}
              <FileCheckCorner className="text-gray-500" style={{ width: `${iconSize.small}px`, height: `${iconSize.small}px`, marginBottom: `${gap * 0.5}px` }} />
              {/* Document lines representation */}
              <div className="w-full max-w-[80%]" style={{ marginTop: `${gap * 0.5}px`, gap: `${gap * 0.5}px` }}>
                <div className="h-0.5 bg-gray-300 rounded w-full" style={{ marginBottom: `${gap * 0.5}px` }}></div>
                <div className="h-0.5 bg-gray-300 rounded w-3/4" style={{ marginBottom: `${gap * 0.5}px` }}></div>
                <div className="h-0.5 bg-gray-300 rounded w-5/6"></div>
              </div>
            </div>
          </div>
        );
      case 'image':
        return (
          <div className="w-full h-full bg-gray-100 flex items-center justify-center">
            <div className="text-gray-400" style={{ fontSize: previewFontSize }}>Image</div>
          </div>
        );
      default:
        return (
          <div className="w-full h-full bg-gray-100 flex items-center justify-center">
            <div className="text-gray-400" style={{ fontSize: previewFontSize }}>Preview</div>
          </div>
        );
    }
  };

  if (type === 'new') {
    return (
      <div className="transition-all duration-75 flex flex-col cursor-pointer w-full" style={{ 
        width: `${cardWidth}px`, 
        minWidth: `${cardWidth}px`, 
        maxWidth: `${cardWidth}px`, 
        height: `${cardHeight}px`,
        minHeight: `${cardHeight}px`, 
        flexShrink: 0, 
        aspectRatio: `${cardWidth}/${cardHeight}`,
        background: 'rgba(255, 255, 255, 0.9)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.08)',
        overflow: 'hidden'
      }}>
        {/* Upper Section - Light grey with plus icon (2/3 of card height) */}
        <div className="flex items-center justify-center flex-[2] border-b" style={{ 
          minHeight: 0, 
          flexShrink: 0,
          background: 'rgba(248, 250, 252, 0.6)',
          borderColor: 'rgba(255, 255, 255, 0.3)'
        }}>
          <Plus className="text-gray-700" style={{ width: `${iconSize.medium}px`, height: `${iconSize.medium}px` }} strokeWidth={2.5} />
        </div>
        {/* Lower Section - White with text (1/3 of card height) */}
        <div className="flex items-center justify-center flex-1" style={{ 
          minHeight: 0, 
          flexShrink: 0,
          background: 'rgba(255, 255, 255, 0.7)'
        }}>
          <span className="font-semibold" style={{ color: '#6E778D', fontSize: fontSize.large }}>New Project</span>
        </div>
      </div>
    );
  }

  if (type === 'blank') {
    return (
      <div className="bg-white overflow-hidden flex flex-col opacity-40 w-full" style={{ 
        width: `${cardWidth}px`, 
        minWidth: `${cardWidth}px`, 
        maxWidth: `${cardWidth}px`, 
        height: `${cardHeight}px`,
        minHeight: `${cardHeight}px`, 
        flexShrink: 0, 
        aspectRatio: `${cardWidth}/${cardHeight}`,
        borderRadius: '6px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05)',
        overflow: 'hidden'
      }}>
        {/* Preview Image - 2/3 of card height */}
        <div className="flex-[2] bg-gray-50" style={{ minHeight: 0, flexShrink: 0 }}></div>
        
        {/* Content Section - 1/3 of card height */}
        <div className="flex flex-col flex-1" style={{ minHeight: 0, flexShrink: 0, padding: `${padding * 0.5}px` }}>
          {/* Empty content */}
        </div>
      </div>
    );
  }

  return (
    <div className="transition-all duration-75 flex flex-col w-full" style={{ 
      width: `${cardWidth}px`, 
      minWidth: `${cardWidth}px`, 
      maxWidth: `${cardWidth}px`, 
      height: `${cardHeight}px`,
      minHeight: `${cardHeight}px`, 
      flexShrink: 0, 
      aspectRatio: `${cardWidth}/${cardHeight}`,
      background: 'rgba(255, 255, 255, 0.9)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderRadius: '4px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.08)',
      overflow: 'hidden'
    }}>
      {/* Preview Image - 2/3 of card height - Infinity Pool Style (no borders, extends to edges) */}
      <div className="flex-[2] overflow-hidden" style={{ 
        flexShrink: 0,
        borderRadius: '4px 4px 0 0' // Only round top corners
      }}>
        {renderPreviewImage()}
      </div>
      
      {/* Content Section - 1/3 of card height */}
      <div className="flex flex-col flex-1" style={{ 
        flexShrink: 0, 
        padding: `${padding * 0.5}px`,
        background: 'rgba(255, 255, 255, 0.85)'
      }}>
        {/* Project Type Label */}
        {projectType && (
          <p className="font-medium text-gray-500 uppercase tracking-wide" style={{ 
            fontSize: fontSize.small, 
            marginBottom: `${gap}px` 
          }}>{projectType}</p>
        )}
        
        {/* Property Address */}
        {propertyAddress && (
          <h3 className="font-semibold line-clamp-2" style={{ 
            color: '#6E778D', 
            fontSize: fontSize.medium,
            marginBottom: `${gap * 1.5}px`
          }}>
            {propertyAddress}
          </h3>
        )}
        
        {/* Meta Row */}
        <div className="flex items-center justify-between mt-auto border-t border-gray-200" style={{ paddingTop: `${gap * 1.5}px` }}>
          <div className="flex items-center font-medium text-gray-600" style={{ fontSize: fontSize.small, gap: `${gap * 4}px` }}>
            {/* Document Count */}
            {documentCount !== undefined && (
              <div className="flex items-center" style={{ gap: `${gap * 0.5}px` }}>
                <FileCheckCorner className="text-gray-600" style={{ width: `${iconSize.small}px`, height: `${iconSize.small}px` }} />
                <span>{documentCount}</span>
              </div>
            )}
            
            {/* Last Opened */}
            {lastOpened && (
              <div className="flex items-center" style={{ gap: `${gap * 0.5}px` }}>
                <Clock className="text-gray-600" style={{ width: `${iconSize.small}px`, height: `${iconSize.small}px` }} />
                <span>{lastOpened}</span>
              </div>
            )}
          </div>
          
          {/* User Avatar */}
          {userAvatar ? (
            <img 
              src={userAvatar} 
              alt="User"
              className="rounded-full object-cover border border-gray-200"
              style={{ width: `${iconSize.small}px`, height: `${iconSize.small}px` }}
            />
          ) : (
            <div className="rounded-full bg-gray-200 border border-gray-300 flex items-center justify-center" style={{ width: `${iconSize.small}px`, height: `${iconSize.small}px` }}>
              <User className="text-gray-600" style={{ width: `${iconSize.small * 0.5}px`, height: `${iconSize.small * 0.5}px` }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

