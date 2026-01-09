"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search, Plus, MapPin, Building2, Loader2, Check } from "lucide-react";
import { backendApi } from "../services/backendApi";

interface PropertyOption {
  id: string;
  address: string;
  documentCount?: number;
  createdAt?: string;
}

export interface PropertySelectorOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProperty: (propertyId: string, propertyAddress: string) => void;
  onCreateNewProperty: () => void;
  tempFileIds: string[];
  filenames: string[];
}

/**
 * PropertySelectorOverlay - Overlay for selecting a property to add files to
 * 
 * Shows when user selects "Add to Project" in the file choice step.
 * Allows user to:
 * 1. Select an existing property
 * 2. Create a new property (redirects to map for pin drop)
 */
export const PropertySelectorOverlay: React.FC<PropertySelectorOverlayProps> = ({
  isOpen,
  onClose,
  onSelectProperty,
  onCreateNewProperty,
  tempFileIds,
  filenames
}) => {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = React.useState<string | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);
  
  // Load properties on mount
  React.useEffect(() => {
    if (isOpen) {
      loadProperties();
    }
  }, [isOpen]);
  
  const loadProperties = async () => {
    setIsLoading(true);
    try {
      const response = await backendApi.getAllPropertyHubs();
      if (response.success && response.data) {
        const propertyList = Array.isArray(response.data) 
          ? response.data 
          : (response.data as any).properties || [];
        
        setProperties(propertyList.map((p: any) => ({
          id: p.id,
          address: p.address || p.formatted_address || 'Unknown address',
          documentCount: p.document_count || 0,
          createdAt: p.created_at
        })));
      }
    } catch (error) {
      console.error('Failed to load properties:', error);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Filter properties by search query
  const filteredProperties = properties.filter(p => 
    p.address.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const handleSelectProperty = async (property: PropertyOption) => {
    setSelectedPropertyId(property.id);
    setIsProcessing(true);
    
    try {
      // Start full processing for temp files
      if (tempFileIds.length > 0) {
        const response = await backendApi.processTempFiles(tempFileIds, property.id);
        if (response.success) {
          console.log('✅ Files queued for processing:', response);
        }
      }
      
      // Notify parent with selection
      onSelectProperty(property.id, property.address);
    } catch (error) {
      console.error('Failed to process files:', error);
    } finally {
      setIsProcessing(false);
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={e => e.stopPropagation()}
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: '12px',
            width: '90%',
            maxWidth: '480px',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
          }}
        >
          {/* Header */}
          <div style={{
            padding: '16px 20px',
            borderBottom: '1px solid #E5E7EB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#111827', margin: 0 }}>
                Add to Project
              </h2>
              <p style={{ fontSize: '13px', color: '#6B7280', margin: '4px 0 0 0' }}>
                Select a property to add {filenames.length} {filenames.length === 1 ? 'file' : 'files'} to
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                padding: '6px',
                cursor: 'pointer',
                borderRadius: '6px',
                color: '#6B7280'
              }}
            >
              <X size={20} />
            </button>
          </div>
          
          {/* Files preview */}
          <div style={{
            padding: '12px 20px',
            backgroundColor: '#F9FAFB',
            borderBottom: '1px solid #E5E7EB'
          }}>
            <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '6px' }}>
              Files to add:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {filenames.map((name, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: '12px',
                    padding: '4px 8px',
                    backgroundColor: '#E5E7EB',
                    borderRadius: '4px',
                    color: '#374151',
                    maxWidth: '200px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
          
          {/* Search */}
          <div style={{ padding: '12px 20px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              backgroundColor: '#F3F4F6',
              borderRadius: '8px',
              border: '1px solid #E5E7EB'
            }}>
              <Search size={16} style={{ color: '#9CA3AF' }} />
              <input
                type="text"
                placeholder="Search properties..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  flex: 1,
                  border: 'none',
                  background: 'none',
                  fontSize: '14px',
                  outline: 'none',
                  color: '#111827'
                }}
              />
            </div>
          </div>
          
          {/* Property list */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0 20px 12px'
          }}>
            {/* Create new property option */}
            <button
              onClick={onCreateNewProperty}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px',
                backgroundColor: '#F5F3FF',
                border: '1px dashed #A78BFA',
                borderRadius: '8px',
                cursor: 'pointer',
                marginBottom: '12px',
                textAlign: 'left'
              }}
            >
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: '#EDE9FE',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Plus size={18} style={{ color: '#7C3AED' }} />
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 500, color: '#7C3AED' }}>
                  Create New Property
                </div>
                <div style={{ fontSize: '12px', color: '#A78BFA' }}>
                  Drop a pin on the map
                </div>
              </div>
            </button>
            
            {/* Properties */}
            {isLoading ? (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px',
                color: '#9CA3AF'
              }}>
                <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
              </div>
            ) : filteredProperties.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: '#9CA3AF'
              }}>
                {searchQuery ? 'No matching properties' : 'No properties yet'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {filteredProperties.map(property => (
                  <motion.button
                    key={property.id}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => handleSelectProperty(property)}
                    disabled={isProcessing}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '12px',
                      backgroundColor: selectedPropertyId === property.id ? '#EFF6FF' : '#FFFFFF',
                      border: selectedPropertyId === property.id ? '2px solid #3B82F6' : '1px solid #E5E7EB',
                      borderRadius: '8px',
                      cursor: isProcessing ? 'not-allowed' : 'pointer',
                      textAlign: 'left',
                      opacity: isProcessing && selectedPropertyId !== property.id ? 0.5 : 1
                    }}
                  >
                    <div style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      backgroundColor: '#F3F4F6',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {selectedPropertyId === property.id && isProcessing ? (
                        <Loader2 size={18} style={{ color: '#3B82F6', animation: 'spin 1s linear infinite' }} />
                      ) : selectedPropertyId === property.id ? (
                        <Check size={18} style={{ color: '#3B82F6' }} />
                      ) : (
                        <Building2 size={18} style={{ color: '#6B7280' }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '14px',
                        fontWeight: 500,
                        color: '#111827',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {property.address}
                      </div>
                      {property.documentCount !== undefined && (
                        <div style={{ fontSize: '12px', color: '#9CA3AF' }}>
                          {property.documentCount} {property.documentCount === 1 ? 'document' : 'documents'}
                        </div>
                      )}
                    </div>
                    <MapPin size={16} style={{ color: '#9CA3AF', flexShrink: 0 }} />
                  </motion.button>
                ))}
              </div>
            )}
          </div>
          
          <style>{`
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}</style>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PropertySelectorOverlay;

