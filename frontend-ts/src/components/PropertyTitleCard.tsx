"use client";

import * as React from "react";
import { Bed, Bath, Ruler, ChevronDown, ChevronUp, FileText, Home, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { backendApi } from "@/services/backendApi";

export interface PropertyTitleCardProps {
  property: {
    id?: string | number;
    property_id?: string | number;
    address?: string;
    property_type?: string;
    bedrooms?: number;
    bathrooms?: number;
    square_feet?: number;
    soldPrice?: number;
    rentPcm?: number;
    askingPrice?: number;
    price?: number;
    image?: string;
    created_at?: string;
    propertyHub?: any;
    summary?: string;
    notes?: string;
    epc_rating?: string;
    tenure?: string;
    transaction_date?: string;
    yield_percentage?: number;
    documentCount?: number;
    document_count?: number;
  };
  onCardClick?: () => void;
  onDelete?: () => void;
}

// Helper function to format price
export const formatPrice = (price: number): string => {
  if (!price || price === 0) return "";
  
  if (price >= 1000000) {
    const millions = price / 1000000;
    return `£${millions.toFixed(1)}M`;
  } else if (price >= 1000) {
    const thousands = price / 1000;
    return `£${thousands.toFixed(0)}k`;
  } else {
    return `£${price}`;
  }
};

// Helper function to get property name from address
export const getPropertyName = (address: string, propertyType?: string): string => {
  if (!address) return propertyType || "Property";
  
  // Extract first part before comma
  const parts = address.split(',').map(p => p.trim());
  const firstPart = parts[0] || address;
  
  // If it's a number followed by street name, use it as-is
  // Otherwise, try to extract meaningful name
  if (firstPart.match(/^\d+/)) {
    return firstPart;
  }
  
  // Try to extract property name (e.g., "Highland huts" from "Highland huts, 254 Highland Ave...")
  const nameMatch = firstPart.match(/^([^0-9]+)/);
  if (nameMatch && nameMatch[1].trim().length > 0) {
    return nameMatch[1].trim();
  }
  
  return firstPart.substring(0, 30);
};

// Helper function to check if property is newly listed
export const isNewlyListed = (createdAt?: string): boolean => {
  if (!createdAt) return false;
  
  try {
    const createdDate = new Date(createdAt);
    const now = new Date();
    const daysDiff = (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysDiff <= 30;
  } catch (e) {
    return false;
  }
};

// Helper function to format address (truncate if too long and remove property name if it was extracted)
export const formatAddress = (address: string, propertyName: string, maxLength: number = 40): string => {
  if (!address) return "";
  
  // Remove property name from the beginning of the address if it matches
  let cleanedAddress = address;
  if (propertyName && propertyName !== "Property") {
    // Check if address starts with the property name (case-insensitive)
    const nameRegex = new RegExp(`^${propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},?\\s*`, 'i');
    cleanedAddress = cleanedAddress.replace(nameRegex, '').trim();
    
    // If we removed something, also remove leading comma if present
    cleanedAddress = cleanedAddress.replace(/^,\s*/, '').trim();
  }
  
  // If cleaned address is empty, fall back to original address
  if (!cleanedAddress) {
    cleanedAddress = address;
  }
  
  // Truncate if too long
  if (cleanedAddress.length <= maxLength) return cleanedAddress;
  return cleanedAddress.substring(0, maxLength - 3) + "...";
};

export const PropertyTitleCard: React.FC<PropertyTitleCardProps> = ({
  property,
  onCardClick,
  onDelete
}) => {
  // State for editing property name
  const [isEditingName, setIsEditingName] = React.useState(false);
  const [editedName, setEditedName] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [isSummaryExpanded, setIsSummaryExpanded] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  
  // Extract property data with fallbacks
  const initialPropertyName = getPropertyName(property.address || "", property.property_type) || "Property";
  const [propertyName, setPropertyName] = React.useState(initialPropertyName);
  const [hasCustomName, setHasCustomName] = React.useState(false); // Track if user has set a custom name
  const address = property.address || "";
  
  // Get property ID from various possible locations
  const propertyId = property.id || property.property_id || property.propertyHub?.property?.id || property.propertyHub?.property_id;
  
  // Cache key for this property's custom name
  const cacheKey = propertyId ? `property_name_${propertyId}` : null;
  
  // Debounce timer ref for database save
  const saveToDbTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  
  // Save to database (debounced)
  const saveToDatabase = React.useCallback(async (name: string) => {
    if (!propertyId) {
      console.warn("Cannot save property name: property ID not found");
      setIsSaving(false);
      return;
    }
    
    try {
      const result = await backendApi.updatePropertyName(propertyId, name);
      if (result.success) {
        console.log("Property name saved to database:", name);
      } else {
        console.error("Failed to save property name to database:", result.error);
      }
    } catch (error) {
      console.error("Error saving property name to database:", error);
    } finally {
      setIsSaving(false);
    }
  }, [propertyId]);
  
  // Save to cache immediately and schedule database save
  const saveName = React.useCallback((newName: string) => {
    // Save to cache immediately for instant feedback
    if (cacheKey) {
      localStorage.setItem(cacheKey, newName);
    }
    
    // Update local state immediately
    setPropertyName(newName);
    setHasCustomName(true);
    setIsEditingName(false);
    setIsSaving(true);
    
    // Clear any existing timer
    if (saveToDbTimerRef.current) {
      clearTimeout(saveToDbTimerRef.current);
    }
    
    // Schedule database save after 2 seconds
    saveToDbTimerRef.current = setTimeout(() => {
      saveToDatabase(newName);
    }, 2000);
  }, [cacheKey, saveToDatabase]);
  
  // Load from cache on mount and when property changes
  React.useEffect(() => {
    if (!cacheKey) {
      // No property ID, use default
      const newName = getPropertyName(property.address || "", property.property_type) || "Property";
      setPropertyName(newName);
      setEditedName(newName);
      return;
    }
    
    // First check cache for instant load (highest priority - most recent)
    const cachedName = localStorage.getItem(cacheKey);
    if (cachedName && cachedName.trim()) {
      setPropertyName(cachedName);
      setEditedName(cachedName);
      setHasCustomName(true);
      return; // Custom name found in cache, never use default
    }
    
    // Then check property details for saved name from database
    const customName = property.propertyHub?.property_details?.other_amenities;
    if (customName) {
      try {
        const parsed = typeof customName === 'string' ? JSON.parse(customName) : customName;
        if (parsed && typeof parsed === 'object' && parsed.custom_name && parsed.custom_name.trim()) {
          setPropertyName(parsed.custom_name);
          setEditedName(parsed.custom_name);
          setHasCustomName(true);
          // Also cache it for faster future loads
          localStorage.setItem(cacheKey, parsed.custom_name);
          return; // Custom name found in database, never use default
        }
      } catch (e) {
        // Not JSON, ignore
      }
    }
    
    // Only set default name if NO custom name was ever set (no cache, no database)
    // This means the user has never edited the name
    const newName = getPropertyName(property.address || "", property.property_type) || "Property";
    setPropertyName(newName);
    setEditedName(newName);
    setHasCustomName(false); // No custom name exists
  }, [property.address, property.property_type, property.propertyHub?.property_details?.other_amenities, cacheKey]);
  
  // Cleanup timer on unmount
  React.useEffect(() => {
    return () => {
      if (saveToDbTimerRef.current) {
        clearTimeout(saveToDbTimerRef.current);
      }
    };
  }, []);
  
  // Format address for display (remove property name if it was extracted from address)
  // Use propertyName state for the current displayed name
  const displayAddress = formatAddress(address, propertyName, 200) || "Address not available";
  const imageUrl = property.image || property.propertyHub?.property?.image || property.propertyHub?.property_details?.primary_image_url || "/property-1.png";
  const bedrooms = property.bedrooms || property.propertyHub?.property_details?.number_bedrooms || 0;
  const bathrooms = property.bathrooms || property.propertyHub?.property_details?.number_bathrooms || 0;
  const squareFeet = property.square_feet || property.propertyHub?.property_details?.size_sqft || 0;
  // Check if size was originally in acres
  const sizeUnit = property.propertyHub?.property_details?.size_unit || '';
  const isInAcres = sizeUnit && (sizeUnit.toLowerCase() === 'acres' || sizeUnit.toLowerCase() === 'acre');
  // Convert to acres if originally described in acres
  // If value is small (< 1000), assume it's already in acres; otherwise convert from square feet
  const acres = isInAcres && squareFeet > 0 
    ? (squareFeet < 1000 ? squareFeet : squareFeet / 43560)
    : 0;
  
  // Calculate document count (priority: propertyHub?.documents?.length > documentCount > document_count)
  let docCount = 0;
  const propertyAny = property as any;
  if (property.propertyHub?.documents?.length) {
    docCount = property.propertyHub.documents.length;
  } else if (propertyAny.documentCount) {
    docCount = propertyAny.documentCount;
  } else if (propertyAny.document_count) {
    docCount = propertyAny.document_count;
  }
  
  // Build property features string for bottom right
  const featuresParts: string[] = [];
  if (bedrooms > 0) featuresParts.push(`${bedrooms} Bed`);
  if (bathrooms > 0) featuresParts.push(`${bathrooms} Bath`);
  if (squareFeet > 0) {
    if (isInAcres && acres > 0) {
      featuresParts.push(`${acres.toFixed(2)} Acres`);
    } else {
      featuresParts.push(`${squareFeet.toLocaleString()} Sqft`);
    }
  }
  const featuresText = featuresParts.join(' • ');

  // Derived Data for Expanded View
  const summaryText = property.summary || property.propertyHub?.property_details?.notes || property.notes;
  const epcRating = property.epc_rating || property.propertyHub?.property_details?.epc_rating;
  const propertyType = property.property_type || property.propertyHub?.property_details?.property_type;
  const tenure = property.tenure || property.propertyHub?.property_details?.tenure;
  const rentPcm = property.rentPcm || property.propertyHub?.property_details?.rentPcm || 0;
  
  // Calculate yield
  let yieldPercentage = property.yield_percentage;
  if (!yieldPercentage && rentPcm > 0) {
    const price = property.soldPrice || property.askingPrice || property.price || 0;
    if (price > 0) {
      yieldPercentage = parseFloat(((rentPcm * 12 / price) * 100).toFixed(1));
    }
  }

  // Letting Info
  const formatLettingDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      const month = date.toLocaleDateString('en-GB', { month: 'short' });
      const year = date.getFullYear();
      return `${month} ${year}`;
    } catch {
      return 'Unknown';
    }
  };
  
  const getLettingInfo = () => {
    const dateStr = property.transaction_date || property.propertyHub?.property_details?.transaction_date;
    if (dateStr && rentPcm > 0) {
      const date = formatLettingDate(dateStr);
      return `Let (AST ${date})`;
    }
    return null;
  };
  const lettingInfo = getLettingInfo();
  
  const handleCardClick = (e: React.MouseEvent) => {
    // Don't trigger card click if user is selecting text
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return; // User is selecting text, don't trigger card click
    }
    
    // Stop event propagation to prevent map click handler from deselecting
    e.stopPropagation();
    onCardClick?.();
  };

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isExpanded) {
      setIsSummaryExpanded(false);
    }
    setIsExpanded(!isExpanded);
  };

  const handleDeleteClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true);
      return;
    }
    
    if (!propertyId) {
      console.error("Cannot delete property: property ID not found");
      return;
    }
    
    setIsDeleting(true);
    
    try {
      const result = await backendApi.deleteProperty(String(propertyId));
      
      if (result.success) {
        console.log("Property deleted successfully");
        // Call the onDelete callback to notify parent component
        onDelete?.();
      } else {
        console.error("Failed to delete property:", result.error);
        alert(`Failed to delete property: ${result.error || 'Unknown error'}`);
        setIsDeleting(false);
        setShowDeleteConfirm(false);
      }
    } catch (error) {
      console.error("Error deleting property:", error);
      alert(`Error deleting property: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(false);
  };

  return (
    <div
      onClick={handleCardClick}
      onWheel={(e) => e.stopPropagation()}
      className="property-title-card-marker"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        cursor: "pointer",
        width: "320px",
        borderRadius: "24px",
        overflow: "hidden",
        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
        background: "#1E1E1E",
        border: "5px solid #000000",
        fontFamily: "'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
        userSelect: "text",
        WebkitUserSelect: "text",
      }}
    >
      {/* Property Image Section - ~33% of card height (100px) */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100px",
          overflow: "hidden",
        }}
      >
        {imageUrl && !imageUrl.includes("/property-1.png") ? (
          <>
          <img
            src={imageUrl}
            alt={propertyName}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
                filter: "blur(0.5px)",
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
            {/* Dark overlay for contrast */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0, 0, 0, 0.15)",
                pointerEvents: "none",
              }}
            />
          </>
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "linear-gradient(135deg, #ef4444 0%, #f97316 50%, #fbbf24 100%)",
              filter: "blur(0.5px)",
            }}
          />
        )}
      </div>
      
      {/* Dark Gray Content Area - ~67% of card height (160px) */}
      <div
        style={{
          position: "relative",
          width: "100%",
          minHeight: "160px",
          background: "#1E1E1E",
          paddingTop: "50px", // Space for tab
          paddingLeft: "18px",
          paddingRight: "18px",
          paddingBottom: "18px",
        }}
      >
        {/* Tab Shape - Protruding from top-left (organic file folder shape with rounded top-right corner) */}
        <div
          style={{
            position: "absolute",
            top: "-22px",
            left: 0,
            width: "220px",
            height: "90px",
            background: "#1E1E1E",
            clipPath: "polygon(0 8px, 1px 6px, 2px 4px, 4px 2px, 6px 1px, 8px 0, 150px 0, 152px 0.2px, 154px 0.8px, 156px 1.8px, 158px 3.2px, 160px 5px, 190px 35px, 192px 36.8px, 194px 38.2px, 196px 39.2px, 198px 39.8px, 200px 40px, 220px 40px, 220px 90px, 0 90px)",
            paddingLeft: "18px",
            paddingTop: "14px",
            paddingRight: "18px",
            paddingBottom: "20px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-start",
            zIndex: isEditingName ? 10001 : 10, // Higher z-index when editing to appear above PropertyDetailsPanel
            overflow: "visible",
          }}
        >
          {/* Delete Button - Top Right */}
          {onDelete && (
            <div
              style={{
                position: "absolute",
                top: "8px",
                right: "8px",
                zIndex: 10002,
              }}
            >
              {showDeleteConfirm ? (
                <div
                  style={{
                    display: "flex",
                    gap: "6px",
                    alignItems: "center",
                    background: "rgba(0, 0, 0, 0.8)",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    fontSize: "11px",
                  }}
                >
                  <button
                    onClick={handleDeleteClick}
                    disabled={isDeleting}
                    style={{
                      background: isDeleting ? "#6B7280" : "#EF4444",
                      color: "#FFFFFF",
                      border: "none",
                      borderRadius: "4px",
                      padding: "2px 8px",
                      cursor: isDeleting ? "not-allowed" : "pointer",
                      fontSize: "11px",
                      fontWeight: 500,
                      opacity: isDeleting ? 0.6 : 1,
                    }}
                  >
                    {isDeleting ? "Deleting..." : "Confirm"}
                  </button>
                  <button
                    onClick={handleCancelDelete}
                    disabled={isDeleting}
                    style={{
                      background: "transparent",
                      color: "#9CA3AF",
                      border: "1px solid #4B5563",
                      borderRadius: "4px",
                      padding: "2px 8px",
                      cursor: isDeleting ? "not-allowed" : "pointer",
                      fontSize: "11px",
                      fontWeight: 500,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleDeleteClick}
                  disabled={isDeleting}
                  style={{
                    background: "rgba(0, 0, 0, 0.6)",
                    border: "none",
                    borderRadius: "6px",
                    padding: "4px",
                    cursor: isDeleting ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: isDeleting ? 0.5 : 1,
                    transition: "background 0.2s, opacity 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isDeleting) {
                      e.currentTarget.style.background = "rgba(239, 68, 68, 0.8)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isDeleting) {
                      e.currentTarget.style.background = "rgba(0, 0, 0, 0.6)";
                    }
                  }}
                >
                  <Trash2 size={14} color="#FFFFFF" />
                </button>
              )}
            </div>
          )}
          
          {/* Property Title in Tab */}
            {isEditingName ? (
              <input
                type="text"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                onBlur={() => {
                  if (!editedName.trim()) {
                    setEditedName(propertyName);
                    setIsEditingName(false);
                    return;
                  }
                  const newName = editedName.trim();
                  saveName(newName);
                }}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                  e.currentTarget.blur();
                  } else if (e.key === 'Escape') {
                    setEditedName(propertyName);
                    setIsEditingName(false);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                style={{
                  fontSize: "20px",
                fontWeight: 600,
                color: "#FFFFFF",
                  margin: 0,
                  marginBottom: "4px",
                  lineHeight: 1.2,
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif",
                  background: "transparent",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                  borderRadius: "4px",
                  padding: "2px 6px",
                  width: "100%",
                  outline: "none",
                  position: "relative",
                  zIndex: 10000, // Ensure it appears above PropertyDetailsPanel tabs
                }}
              />
            ) : (
              <h3
                onClick={(e) => {
                  e.stopPropagation();
                  setEditedName(propertyName);
                  setIsEditingName(true);
                }}
                style={{
                  fontSize: "20px",
                fontWeight: 600,
                color: "#FFFFFF",
                  margin: 0,
                  marginBottom: "4px",
                  lineHeight: 1.2,
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif",
                  cursor: "pointer",
                }}
              >
                {propertyName}
              </h3>
            )}
          
          {/* Address in Tab (below title) */}
        <p
          style={{
            fontSize: "13px",
              color: "#9CA3AF",
            margin: 0,
            lineHeight: 1.4,
              fontWeight: 400,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif",
          }}
        >
          {displayAddress}
        </p>
        </div>
        
        {/* Bottom Stats Section */}
        <div
          style={{
            position: "absolute",
            bottom: "40px",
            left: "18px",
            right: "18px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          {/* Left Side - Document Count */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "baseline",
            }}
          >
            <span
              style={{
                fontSize: "16px",
                fontWeight: 600,
                color: "#FFFFFF",
                lineHeight: 1,
                fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif",
              }}
            >
              {docCount.toString().padStart(2, '0')}
            </span>
            <span
              style={{
                fontSize: "10px",
                color: "#9CA3AF",
                fontWeight: 400,
                fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif",
                marginLeft: "3px",
              }}
            >
              Documents
            </span>
          </div>
          
          {/* Right Side - Property Features */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {bedrooms > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <Bed size={13} color="#FFFFFF" />
                <span
                  style={{
                    fontSize: "10px",
                    color: "#FFFFFF",
                    fontWeight: 400,
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif",
                    whiteSpace: "nowrap",
                  }}
                >
                  {bedrooms} Bed
                </span>
              </div>
            )}
            {bathrooms > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <Bath size={13} color="#FFFFFF" />
                <span
                  style={{
                    fontSize: "10px",
                    color: "#FFFFFF",
                    fontWeight: 400,
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif",
                    whiteSpace: "nowrap",
                  }}
                >
                  {bathrooms} Bath
                </span>
              </div>
            )}
            {squareFeet > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <Ruler size={13} color="#FFFFFF" />
                <span
                  style={{
                    fontSize: "10px",
                    color: "#FFFFFF",
                    fontWeight: 400,
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif",
                    whiteSpace: "nowrap",
                  }}
                >
                  {isInAcres && acres > 0 ? `${acres.toFixed(2)} Acres` : `${squareFeet.toLocaleString()} Sqft`}
                </span>
              </div>
            )}
          </div>
        </div>
          </div>
          
      {/* Expandable Details Section */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            style={{
              overflow: "hidden",
              background: "#333939",
              paddingLeft: "18px",
              paddingRight: "18px",
            }}
          >
            <div style={{ paddingTop: "16px", paddingBottom: "60px", position: "relative" }}>
              {/* Default Content Layer (Blurred when summary expanded) */}
              <div style={{ 
                filter: isSummaryExpanded ? "blur(4px)" : "none",
                transition: "filter 0.2s ease"
              }}>
                {/* Summary Text Placeholder */}
                {summaryText && (
                  <div style={{ marginBottom: "24px", visibility: isSummaryExpanded ? "hidden" : "visible" }}>
                    <p
                      style={{
                        fontSize: "13px",
                        color: "#E5E7EB",
                        lineHeight: "1.6",
                        letterSpacing: "0.01em",
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        marginBottom: "4px",
                        whiteSpace: "pre-line"
                      }}
                    >
                      {summaryText.replace(/\. /g, '.\n')}
                    </p>
                    {summaryText.length > 120 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsSummaryExpanded(true);
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#FFFFFF",
                          fontSize: "12px",
                          fontWeight: 500,
                          padding: 0,
                          cursor: "pointer",
                          opacity: 0.8
                        }}
                      >
                        View more
                      </button>
                    )}
                  </div>
                )}

                {/* Tags/Features */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
                  {epcRating && (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <FileText size={14} color="#FFFFFF" />
                      <span style={{ fontSize: "12px", color: "#FFFFFF" }}>EPC {epcRating}</span>
                    </div>
                  )}
                  {propertyType && (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <Home size={14} color="#FFFFFF" />
                      <span style={{ fontSize: "12px", color: "#FFFFFF" }}>{propertyType}</span>
                    </div>
                  )}
                  {tenure && (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <FileText size={14} color="#FFFFFF" />
                      <span style={{ fontSize: "12px", color: "#FFFFFF" }}>{tenure}</span>
                    </div>
                  )}
                </div>

                {/* Financial Info */}
                {(rentPcm > 0 || lettingInfo) && (
                  <div style={{ 
                    paddingTop: "12px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "4px"
                  }}>
                    {rentPcm > 0 && (
                      <div style={{ fontSize: "13px", color: "#FFFFFF" }}>
                        <span style={{ fontWeight: 500, color: "#FFFFFF" }}>Rent:</span> £{rentPcm.toLocaleString()} pcm
                        {yieldPercentage && (
                          <span style={{ color: "#D1D5DB", marginLeft: "6px" }}>({yieldPercentage}% yield)</span>
                        )}
                      </div>
                    )}
                    {lettingInfo && (
                      <div style={{ fontSize: "13px", color: "#FFFFFF" }}>
                        <span style={{ fontWeight: 500, color: "#FFFFFF" }}>Letting:</span> {lettingInfo}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded Summary Overlay */}
      {isExpanded && isSummaryExpanded && summaryText && (
        <div 
          onClick={(e) => e.stopPropagation()}
          style={{
          position: "absolute",
          top: "170px",
          left: 0,
          right: 0,
          bottom: 0,
          paddingTop: "16px",
          paddingBottom: "10px",
          paddingLeft: "18px",
          paddingRight: "18px",
          background: "rgba(51, 57, 57, 0.95)",
          backdropFilter: "blur(4px)",
          zIndex: 25,
          display: "flex",
          flexDirection: "column"
        }}>
          <div className="tabs-scrollbar" style={{ flex: 1, overflowY: "auto", paddingRight: "4px", marginBottom: "8px" }}>
            <p
              style={{
                fontSize: "13px",
                color: "#FFFFFF",
                lineHeight: "1.5",
                marginBottom: "4px",
                whiteSpace: "pre-line"
              }}
            >
              {summaryText.replace(/\. /g, '.\n\n')}
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsSummaryExpanded(false);
            }}
            style={{
              background: "none",
              border: "none",
              color: "#FFFFFF",
              fontSize: "12px",
              fontWeight: 500,
              padding: 0,
              cursor: "pointer",
              opacity: 0.8,
              alignSelf: "flex-start"
            }}
          >
            View less
          </button>
        </div>
      )}

      {/* Toggle Button */}
      <div
        onClick={toggleExpand}
        style={{
          position: "absolute",
          bottom: "0",
          left: "0",
          right: "0",
          height: "40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          zIndex: 20,
        }}
      >
        <div style={{ position: "relative", zIndex: 1, display: "flex" }}>
          {isExpanded ? (
            <ChevronUp size={16} color="#9CA3AF" />
          ) : (
            <ChevronDown size={16} color="#9CA3AF" />
          )}
        </div>
      </div>
    </div>
  );
};
