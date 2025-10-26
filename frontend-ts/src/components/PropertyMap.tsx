import React, { useState, useEffect } from 'react';
import { getAllPropertyNodes, getPropertyNodeDetails, PropertyNode, PropertyWithDocuments } from '../services/backendApi';

export const PropertyMap: React.FC = () => {
  const [properties, setProperties] = useState<PropertyNode[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<PropertyWithDocuments | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProperties = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getAllPropertyNodes();
        setProperties(data);
      } catch (error) {
        console.error('Error fetching properties:', error);
        setError(error instanceof Error ? error.message : 'Failed to fetch properties');
      } finally {
        setLoading(false);
      }
    };

    fetchProperties();
  }, []);

  const handlePropertyClick = async (propertyId: string) => {
    try {
      setError(null);
      const data = await getPropertyNodeDetails(propertyId);
      setSelectedProperty(data);
    } catch (error) {
      console.error('Error fetching property details:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch property details');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-lg">Loading properties...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-red-600">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="property-map-container flex h-screen">
      {/* Properties List */}
      <div className="properties-list w-1/3 bg-gray-50 p-4 overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">Properties ({properties.length})</h2>
        
        {properties.length === 0 ? (
          <div className="text-gray-500">No properties found</div>
        ) : (
          <div className="space-y-2">
            {properties.map(property => (
              <div 
                key={property.id} 
                className="property-card bg-white p-4 rounded-lg shadow-sm border cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handlePropertyClick(property.id)}
              >
                <h3 className="font-semibold text-gray-800">{property.formatted_address}</h3>
                <p className="text-sm text-gray-600">Documents: {property.document_count}</p>
                <p className="text-xs text-gray-500">
                  Coordinates: ({property.latitude?.toFixed(4)}, {property.longitude?.toFixed(4)})
                </p>
                <p className="text-xs text-gray-400">
                  Created: {new Date(property.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Property Details */}
      <div className="property-details flex-1 p-4 bg-white overflow-y-auto">
        {selectedProperty ? (
          <div>
            <h2 className="text-2xl font-bold mb-4">{selectedProperty.property.formatted_address}</h2>
            
            {/* Property Info */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-lg font-semibold mb-2">Property Information</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Address Hash:</span>
                  <span className="ml-2 font-mono text-xs">{selectedProperty.property.address_hash.substring(0, 16)}...</span>
                </div>
                <div>
                  <span className="font-medium">Coordinates:</span>
                  <span className="ml-2">
                    ({selectedProperty.property.latitude?.toFixed(6)}, {selectedProperty.property.longitude?.toFixed(6)})
                  </span>
                </div>
                <div>
                  <span className="font-medium">Business ID:</span>
                  <span className="ml-2">{selectedProperty.property.business_id}</span>
                </div>
                <div>
                  <span className="font-medium">Created:</span>
                  <span className="ml-2">{new Date(selectedProperty.property.created_at).toLocaleString()}</span>
                </div>
              </div>
            </div>
            
            {/* Documents Section */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-4">
                Linked Documents ({selectedProperty.document_count})
              </h3>
              
              {selectedProperty.documents.length === 0 ? (
                <div className="text-gray-500">No documents linked to this property</div>
              ) : (
                <div className="grid gap-3">
                  {selectedProperty.documents.map(doc => (
                    <div key={doc.id} className="document-card bg-white border rounded-lg p-4 shadow-sm">
                      <h4 className="font-medium text-gray-800">{doc.original_filename}</h4>
                      <div className="mt-2 text-sm text-gray-600">
                        <p><span className="font-medium">Type:</span> {doc.classification_type}</p>
                        <p><span className="font-medium">Status:</span> {doc.status}</p>
                        <p><span className="font-medium">Uploaded:</span> {new Date(doc.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Extracted Properties Section */}
            {selectedProperty.extracted_properties.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-4">
                  Extracted Properties ({selectedProperty.extracted_property_count})
                </h3>
                <div className="grid gap-3">
                  {selectedProperty.extracted_properties.map((prop, index) => (
                    <div key={index} className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap">
                        {JSON.stringify(prop, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <h3 className="text-lg font-medium mb-2">Select a Property</h3>
              <p>Click on a property from the list to view its details and linked documents.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
