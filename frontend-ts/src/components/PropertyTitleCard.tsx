"use client";

import * as React from "react";
import { Bed, Bath, Ruler } from "lucide-react";
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
  };
  onCardClick?: () => void;
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
  onCardClick
}) => {
  // State for editing property name
  const [isEditingName, setIsEditingName] = React.useState(false);
  const [editedName, setEditedName] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  
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
  const displayAddress = formatAddress(address, propertyName, 35) || "Address not available";
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
  
  // Get price (priority: soldPrice > askingPrice > rentPcm)
  const price = property.soldPrice || property.askingPrice || property.rentPcm || property.price || 0;
  const formattedPrice = price > 0 ? formatPrice(price) : "";
  
  // Check if newly listed
  const newlyListed = isNewlyListed(property.created_at || property.propertyHub?.property?.created_at);
  
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

  return (
    <div
      onClick={handleCardClick}
      className="property-title-card-marker"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        cursor: "pointer",
        width: "320px",
        borderRadius: "14px",
        overflow: "hidden",
        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
        background: "#000000",
        fontFamily: "'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
        userSelect: "text", // Allow text selection
        WebkitUserSelect: "text", // Safari
      }}
    >
      {/* Property Image Section - 66% of card height */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "240px",
          overflow: "hidden",
        }}
      >
        {imageUrl && !imageUrl.includes("/property-1.png") ? (
          <img
            src={imageUrl}
            alt={propertyName}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: "14px",
              fontWeight: 500,
            }}
          >
            {propertyName}
          </div>
        )}
        
        {/* Blur Gradient Overlay - smooth gradual transition from image to information section */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "120px",
            background: "linear-gradient(to bottom, transparent 0%, rgba(25, 30, 29, 0.05) 20%, rgba(25, 30, 29, 0.15) 40%, rgba(25, 30, 29, 0.35) 60%, rgba(25, 30, 29, 0.6) 75%, rgba(25, 30, 29, 0.85) 90%, #191E1D 100%)",
            pointerEvents: "none",
          }}
        />
        
        {/* Image Carousel Indicators - 4 dots, first solid, others outlined */}
        <div
          style={{
            position: "absolute",
            bottom: "12px",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: "8px",
            alignItems: "center",
            zIndex: 1,
          }}
        >
          {/* First dot - solid white */}
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "white",
              opacity: 1,
            }}
          />
          {/* Other dots - outlined (border only) */}
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "transparent",
              border: "2px solid white",
              opacity: 0.4,
            }}
          />
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "transparent",
              border: "2px solid white",
              opacity: 0.4,
            }}
          />
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "transparent",
              border: "2px solid white",
              opacity: 0.4,
            }}
          />
        </div>
      </div>
      
      {/* Property Details Section - 33% of card height, solid dark green background */}
      <div
        style={{
          width: "100%",
          padding: "18px",
          background: "#191E1D",
          minHeight: "120px",
        }}
      >
        {/* Property Name and Price Row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "6px",
          }}
        >
          <div style={{ flex: 1, marginRight: "12px" }}>
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
                    e.currentTarget.blur(); // Trigger blur which will handle the save
                  } else if (e.key === 'Escape') {
                    setEditedName(propertyName);
                    setIsEditingName(false);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                style={{
                  fontSize: "20px",
                  fontWeight: 400,
                  color: "white",
                  margin: 0,
                  marginBottom: "4px",
                  lineHeight: 1.2,
                  letterSpacing: "-0.2px",
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif",
                  background: "transparent",
                  border: "1px solid rgba(255, 255, 255, 0.3)",
                  borderRadius: "4px",
                  padding: "2px 6px",
                  width: "100%",
                  outline: "none",
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
                  fontWeight: 400,
                  color: "white",
                  margin: 0,
                  marginBottom: "4px",
                  lineHeight: 1.2,
                  letterSpacing: "-0.2px",
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif",
                  cursor: "pointer",
                }}
              >
                {propertyName}
              </h3>
            )}
          </div>
          {formattedPrice && (
            <div
              style={{
                fontSize: "20px",
                fontWeight: 400,
                color: "white",
                whiteSpace: "nowrap",
                lineHeight: 1.2,
                letterSpacing: "-0.2px",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif",
              }}
            >
              {formattedPrice}
            </div>
          )}
        </div>
        
        {/* Address */}
        <p
          style={{
            fontSize: "13px",
            color: "#979F95",
            margin: 0,
            marginBottom: "14px",
            lineHeight: 1.4,
            fontWeight: 300,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif",
          }}
        >
          {displayAddress}
        </p>
        
        {/* Separator Line */}
        <div
          style={{
            width: "100%",
            height: "1px",
            background: "#979F95",
            opacity: 0.3,
            marginBottom: "14px",
          }}
        />
        
        {/* Property Stats Bar - Horizontal row, no dividers */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "8px",
          }}
        >
          {/* Bedrooms */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: "6px",
              flex: 1,
            }}
          >
            <Bed
              size={16}
              color="#979F95"
              strokeWidth={2}
            />
            <span
              style={{
                fontSize: "12px",
                color: "#979F95",
                fontWeight: 400,
                fontFamily: "'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
              }}
            >
              Bed: {bedrooms > 0 ? bedrooms : "N/A"}
            </span>
          </div>
          
          {/* Bathrooms */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: "6px",
              flex: 1,
            }}
          >
            <Bath
              size={16}
              color="#979F95"
              strokeWidth={2}
            />
            <span
              style={{
                fontSize: "12px",
                color: "#979F95",
                fontWeight: 400,
                fontFamily: "'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
              }}
            >
              Baths: {bathrooms > 0 ? bathrooms : "N/A"}
            </span>
          </div>
          
          {/* Square Feet */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: "6px",
              flex: 1,
            }}
          >
            <Ruler
              size={16}
              color="#979F95"
              strokeWidth={2}
            />
            <span
              style={{
                fontSize: "12px",
                color: "#979F95",
                fontWeight: 400,
                fontFamily: "'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
              }}
            >
              {isInAcres && acres > 0 
                ? `Acres: ${acres.toFixed(2)}` 
                : `Sqft: ${squareFeet > 0 ? squareFeet.toLocaleString() : "N/A"}`}
            </span>
          </div>
        </div>
      </div>
      
    </div>
  );
};

