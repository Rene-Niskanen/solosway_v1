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
import { Plus } from "lucide-react";
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
}

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

export const ProjectGlassCard: React.FC<ProjectGlassCardProps> = React.memo(({ property, onClick, onDocumentDrop }) => {
  // Drag-over state for visual feedback
  const [isDragOver, setIsDragOver] = React.useState(false);
  
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
      className="cursor-pointer relative select-none"
      style={{
        width: '580px',
        maxWidth: '580px',
        borderRadius: '10px',
        padding: '28px',
        background: 'linear-gradient(145deg, #ffffff 0%, #f8f9fa 100%)',
        boxShadow: isDragOver 
          ? '0 8px 24px rgba(59, 130, 246, 0.2), 0 4px 8px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)'
          : '0 8px 20px -4px rgba(0, 0, 0, 0.1), 0 4px 8px -2px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
        border: '1px solid rgba(0, 0, 0, 0.06)',
        borderTop: '1px solid rgba(255, 255, 255, 0.8)',
        outline: isDragOver ? '2px dashed #3B82F6' : 'none',
        outlineOffset: '4px',
      }}
      whileHover={{ 
        y: -6, 
        boxShadow: '0 20px 40px -8px rgba(0, 0, 0, 0.15), 0 8px 16px -4px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 1)',
      }}
      whileTap={{ scale: 0.98, y: -3 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      onClick={onClick}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex gap-8">
        {/* Left: Text Content */}
        <div className="flex-1 min-w-0">
          {/* Title - Large, dark grey, semibold */}
          <h2 
            className="mb-2"
            style={{
              fontSize: '26px',
              fontWeight: 600,
              color: '#1F2937',
              lineHeight: 1.2,
            }}
          >
            {propertyName}
          </h2>
          
          {/* Subtitle - Property type */}
          <p 
            className="mb-3"
            style={{
              fontSize: '15px',
              color: '#6B7280',
              fontWeight: 500,
            }}
          >
            {propertyType}
          </p>
          
          {/* Property details row (if available) */}
          {(property.bedrooms || property.bathrooms || property.size_sqft) && (
            <div 
              className="flex gap-4 mb-3"
              style={{ fontSize: '13px', color: '#6B7280' }}
            >
              {property.bedrooms && (
                <span>{property.bedrooms} bed{property.bedrooms !== 1 ? 's' : ''}</span>
              )}
              {property.bathrooms && (
                <span>{property.bathrooms} bath{property.bathrooms !== 1 ? 's' : ''}</span>
              )}
              {property.size_sqft && (
                <span>{property.size_sqft.toLocaleString()} {property.size_unit || 'sqft'}</span>
              )}
            </div>
          )}
          
          {/* Description or address */}
          <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
            {property.notes || property.description || (
              property.document_count 
                ? `Text, images, and documents about ${propertyName}. ${property.formatted_address || property.address || ''}`
                : property.formatted_address || property.address || 'Property location'
            )}
          </div>
        </div>
        
        {/* Right: Nested Floating Preview Card with property image */}
        <div className="relative flex-shrink-0" style={{ width: '180px', height: '220px' }}>
          <div 
            className="overflow-hidden"
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '8px',
              background: 'linear-gradient(145deg, #ffffff 0%, #f5f5f5 100%)',
              boxShadow: '0 6px 16px -2px rgba(0, 0, 0, 0.12), 0 3px 6px -2px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.6)',
              border: '1px solid rgba(0, 0, 0, 0.05)',
            }}
          >
            <img 
              src={property.primary_image_url || '/PROJECTS-no.image.png'} 
              alt={propertyName}
              className="w-full h-full object-cover pointer-events-none"
              style={{ backgroundColor: '#FAFAFA' }}
              draggable={false}
            />
          </div>
        </div>
      </div>
      
      {/* OpenAI-style Add Button - appears when dragging over */}
      <div 
        className="absolute flex items-center justify-center pointer-events-none"
        style={{
          bottom: '16px',
          right: '16px',
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          backgroundColor: '#3B82F6',
          boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
          opacity: isDragOver ? 1 : 0,
          transform: isDragOver ? 'scale(1)' : 'scale(0.8)',
          transition: 'opacity 150ms ease, transform 150ms ease',
        }}
      >
        <Plus className="w-5 h-5 text-white" strokeWidth={2.5} />
      </div>
    </motion.div>
  );
});

// Display name for debugging
ProjectGlassCard.displayName = 'ProjectGlassCard';

export default ProjectGlassCard;
