"use client";

import * as React from "react";
import { Plus, FileCheckCorner, ClockFading, User } from "lucide-react";

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
}

export const RecentProjectCard: React.FC<RecentProjectCardProps> = ({
  type,
  projectType,
  propertyAddress,
  lastFile,
  documentCount,
  lastOpened,
  userAvatar
}) => {
  // Render preview image based on last file type
  const renderPreviewImage = () => {
    if (!lastFile) {
      return (
        <div className="w-full h-full bg-gray-100 flex items-center justify-center">
          <div className="text-gray-400 text-xs">No preview</div>
        </div>
      );
    }

    // If we have a thumbnail URL, use it
    if (lastFile.thumbnail) {
      return (
        <div className="w-full h-full overflow-hidden">
          <img 
            src={lastFile.thumbnail} 
            alt="Project preview"
            className="w-full h-full object-cover"
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
            <div className="text-blue-400 text-xs font-medium">Map View</div>
          </div>
        );
      case 'floorplan':
        return (
          <div className="w-full h-full bg-gray-50 flex items-center justify-center">
            <div className="text-gray-500 text-xs font-medium">Floor Plan</div>
          </div>
        );
      case 'document':
        return (
          <div className="w-full h-full bg-white flex flex-col items-center justify-center relative overflow-hidden">
            {/* Document preview representation */}
            <div className="w-full h-full bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col items-center justify-center p-2">
              {/* Document icon */}
              <FileCheckCorner className="w-4 h-4 text-gray-500 mb-0.5" />
              {/* Document lines representation */}
              <div className="w-full max-w-[80%] space-y-0.5 mt-1">
                <div className="h-0.5 bg-gray-300 rounded w-full"></div>
                <div className="h-0.5 bg-gray-300 rounded w-3/4"></div>
                <div className="h-0.5 bg-gray-300 rounded w-5/6"></div>
              </div>
            </div>
          </div>
        );
      case 'image':
        return (
          <div className="w-full h-full bg-gray-100 flex items-center justify-center">
            <div className="text-gray-400 text-xs">Image</div>
          </div>
        );
      default:
        return (
          <div className="w-full h-full bg-gray-100 flex items-center justify-center">
            <div className="text-gray-400 text-xs">Preview</div>
          </div>
        );
    }
  };

  if (type === 'new') {
    return (
      <div className="bg-gray-100 rounded-lg border border-gray-200 shadow-md overflow-hidden hover:shadow-lg transition-all duration-75 flex flex-col cursor-pointer h-full">
        {/* Upper Section - Light grey with plus icon (2/3 of card height) */}
        <div className="bg-gray-100 flex items-center justify-center flex-[2] border-b border-gray-200">
          <Plus className="w-8 h-8 text-gray-700" strokeWidth={2.5} />
        </div>
        {/* Lower Section - White with text (1/3 of card height) */}
        <div className="bg-white flex items-center justify-center flex-1">
          <span className="text-xs font-semibold" style={{ color: '#6E778D' }}>New Project</span>
        </div>
      </div>
    );
  }

  if (type === 'blank') {
    return (
      <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden flex flex-col h-full opacity-40">
        {/* Preview Image - 2/3 of card height */}
        <div className="flex-[2] bg-gray-50"></div>
        
        {/* Content Section - 1/3 of card height */}
        <div className="flex flex-col flex-1 p-3">
          {/* Empty content */}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-300 overflow-hidden hover:shadow-lg hover:border-gray-400 transition-all duration-75 flex flex-col h-full">
      {/* Preview Image - 2/3 of card height */}
      <div className="flex-[2] overflow-hidden">
        {renderPreviewImage()}
      </div>
      
      {/* Content Section - 1/3 of card height */}
      <div className="flex flex-col flex-1 p-3">
        {/* Project Type Label */}
        {projectType && (
          <p className="text-[10px] font-medium text-gray-500 mb-1 uppercase tracking-wide">{projectType}</p>
        )}
        
        {/* Property Address */}
        {propertyAddress && (
          <h3 className="text-xs font-semibold mb-2 line-clamp-2" style={{ color: '#6E778D' }}>
            {propertyAddress}
          </h3>
        )}
        
        {/* Meta Row */}
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-200">
          <div className="flex items-center gap-3 text-[10px] font-medium text-gray-600">
            {/* Document Count */}
            {documentCount !== undefined && (
              <div className="flex items-center gap-1">
                <FileCheckCorner className="w-3 h-3 text-gray-600" />
                <span>{documentCount}</span>
              </div>
            )}
            
            {/* Last Opened */}
            {lastOpened && (
              <div className="flex items-center gap-1">
                <ClockFading className="w-3 h-3 text-gray-600" />
                <span>{lastOpened}</span>
              </div>
            )}
          </div>
          
          {/* User Avatar */}
          {userAvatar ? (
            <img 
              src={userAvatar} 
              alt="User"
              className="w-5 h-5 rounded-full object-cover border border-gray-200"
            />
          ) : (
            <div className="w-5 h-5 rounded-full bg-gray-200 border border-gray-300 flex items-center justify-center">
              <User className="w-2.5 h-2.5 text-gray-600" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

