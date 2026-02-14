"use client";

/**
 * ProjectGlassCard - Displays a project card with glassmorphism styling
 * 
 * IMPORTANT: In Velora, Properties (property pins) = Projects
 * This component accepts property data and displays it as a project card.
 * 
 * Supports drag-and-drop: Documents can be dropped onto this card to link them.
 */

import * as React from "react";
import { Plus, Check } from "lucide-react";
import { motion } from "framer-motion";

// Properties = Projects (same concept)
// Backend uses "Property", UI displays as "Project"
interface PropertyData {
  id: string;
  address?: string;
  formatted_address?: string;
  property_type?: string;
  document_count?: number;
  created_at?: string;
  updated_at?: string;
  primary_image_url?: string;
  latitude?: number;
  longitude?: number;
  // Property details
  bedrooms?: number;
  bathrooms?: number;
  size_sqft?: number;
  size_unit?: string;
  year_built?: number;
  description?: string;
  notes?: string;
}

interface ProjectGlassCardProps {
  /** Property data (which represents a Project in Velora) */
  property: PropertyData;
  onClick?: () => void;
  /** Callback when a document is dropped onto this card */
  onDocumentDrop?: (documentId: string, propertyId: string) => void;
  /** When true, card shows selection checkbox and click toggles selection */
  selectionMode?: boolean;
  /** Whether this card is selected (used with selectionMode) */
  selected?: boolean;
  /** Called when user toggles selection (e.g. clicks card in selection mode) */
  onToggleSelect?: (e: React.MouseEvent) => void;
  /** Called when user hovers over the card (e.g. to preload document thumbnails for faster open) */
  onMouseEnter?: () => void;
}

// Max length for project name display (based on longest current names in UI)
const MAX_PROJECT_NAME_LENGTH = 23;

// Extract property name from address (first part before comma)
const getPropertyName = (address: string): string => {
  if (!address) return "Property";
  const parts = address.split(',').map(p => p.trim());
  const firstPart = parts[0] || address;
  // If it starts with a number, try to get a meaningful name
  if (firstPart.match(/^\d+/)) {
    return firstPart.substring(0, 30);
  }
  const nameMatch = firstPart.match(/^([^0-9]+)/);
  if (nameMatch && nameMatch[1].trim().length > 0) {
    return nameMatch[1].trim();
  }
  return firstPart.substring(0, 30);
};

const truncateProjectName = (name: string): string => {
  if (name.length <= MAX_PROJECT_NAME_LENGTH) return name;
  return name.slice(0, MAX_PROJECT_NAME_LENGTH) + "...";
};

export const ProjectGlassCard: React.FC<ProjectGlassCardProps> = React.memo(({ property, onClick, onDocumentDrop, selectionMode, selected, onToggleSelect, onMouseEnter }) => {
  // Drag-over state for visual feedback
  const [isDragOver, setIsDragOver] = React.useState(false);

  const handleClick = React.useCallback((e: React.MouseEvent) => {
    if (selectionMode && onToggleSelect) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect(e);
    } else if (onClick) {
      onClick();
    }
  }, [selectionMode, onToggleSelect, onClick]);
  
  // Format date like reference: "May 9, 2019"
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', { 
      month: 'long', day: 'numeric', year: 'numeric' 
    });
  };

  const propertyName = getPropertyName(property.address || property.formatted_address || '');
  const propertyType = property.property_type || 'Property';
  const formattedDate = formatDate(property.created_at);
  
  // Handle drag over - allow drop if it's a document
  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Check if dragging a document
    const hasJsonData = e.dataTransfer.types.includes('application/json');
    if (hasJsonData) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);
  
  // Handle drag enter - show visual feedback
  const handleDragEnter = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const hasJsonData = e.dataTransfer.types.includes('application/json');
    if (hasJsonData) {
      setIsDragOver(true);
    }
  }, []);
  
  // Handle drag leave - hide visual feedback
  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only hide if actually leaving the card (not entering a child)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragOver(false);
    }
  }, []);
  
  // Handle drop - extract document data and call callback
  const handleDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    try {
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        const data = JSON.parse(jsonData);
        if (data.type === 'document' && data.documentId && onDocumentDrop) {
          onDocumentDrop(data.documentId, property.id);
        }
      }
    } catch (error) {
      console.error('[ProjectGlassCard] Failed to parse drop data:', error);
    }
  }, [onDocumentDrop, property.id]);

  return (
    <motion.div 
      className="cursor-pointer relative select-none overflow-visible flex flex-col items-center h-full"
      style={{
        width: '100%',
        minHeight: 0,
        padding: '0',
        background: 'transparent',
        boxShadow: 'none',
        border: 'none',
        outline: isDragOver ? '2px dashed #3B82F6' : 'none',
        outlineOffset: '4px',
        // Ensure card receives pointer events and sits above grid so hover/click always register
        pointerEvents: 'auto',
        zIndex: 0,
      }}
      whileHover={{ scale: 1.02, zIndex: 1 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Card container: fixed height so all cards match; blue border when selected */}
      <div
        className="flex flex-col items-center w-full h-full min-w-0"
        style={{
          borderRadius: '12px',
          border: selected ? '2px solid #3B82F6' : '2px solid transparent',
          padding: '12px',
          boxSizing: 'border-box',
          position: 'relative',
          height: '100%',
        }}
      >
        {/* Checkmark badge: top-right, slightly overlapping the card border */}
        {selectionMode && (
          <div
            className="absolute flex items-center justify-center pointer-events-none"
            style={{
              top: '-2px',
              right: '-2px',
              width: '20px',
              height: '20px',
              borderRadius: '4px',
              backgroundColor: selected ? '#3B82F6' : 'rgba(255,255,255,0.95)',
              border: selected ? 'none' : '1px solid rgba(0,0,0,0.12)',
              boxShadow: selected ? '0 1px 3px rgba(59, 130, 246, 0.4)' : '0 1px 2px rgba(0,0,0,0.08)',
            }}
          >
            {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
          </div>
        )}

        {/* Folder icon - fixed size so every card shows the same dimensions */}
        <div 
          className="relative overflow-hidden flex items-center justify-center flex-shrink-0"
          style={{ 
            width: '140px',
            height: '122px',
            filter: isDragOver ? 'brightness(0.95)' : 'none',
          }}
        >
          <img 
            src="/projectsfolder.png" 
            alt=""
            className="w-full h-full object-contain pointer-events-none"
            style={{ display: 'block' }}
            draggable={false}
          />
        </div>

        {/* Project name below folder - single line, max length with ellipsis */}
        <p 
          className="text-center w-full mt-2 px-1 min-w-0"
          style={{
            fontSize: '13px',
            fontWeight: 500,
            color: '#1F2937',
            lineHeight: 1.3,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={propertyName}
        >
          {truncateProjectName(propertyName)}
        </p>
      </div>
      
      {/* Add indicator when dragging over */}
      <div 
        className="absolute flex items-center justify-center pointer-events-none"
        style={{
          top: '50%',
          left: '50%',
          marginTop: '-16px',
          marginLeft: '-16px',
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          backgroundColor: '#3B82F6',
          boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
          opacity: isDragOver ? 1 : 0,
          transform: isDragOver ? 'scale(1)' : 'scale(0.8)',
          transition: 'opacity 150ms ease, transform 150ms ease',
        }}
      >
        <Plus className="w-4 h-4 text-white" strokeWidth={2.5} />
      </div>
    </motion.div>
  );
});

// Display name for debugging
ProjectGlassCard.displayName = 'ProjectGlassCard';

export default ProjectGlassCard;
