"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBackendApi } from './BackendApi';

interface PropertyDetailsPanelProps {
  property: any;
  isVisible: boolean;
  onClose: () => void;
}

interface Document {
  id: string;
  original_filename: string;
  classification_type: string;
  classification_confidence: number;
  created_at: string;
  status: string;
  parsed_text?: string;
  extracted_json?: string;
}

export const PropertyDetailsPanel: React.FC<PropertyDetailsPanelProps> = ({
  property,
  isVisible,
  onClose
}) => {
  const backendApi = useBackendApi();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load documents when property changes
  useEffect(() => {
    if (property && property.id) {
      loadPropertyDocuments();
    }
  }, [property]);

  const loadPropertyDocuments = async () => {
    if (!property?.id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      console.log('📄 Loading documents for property:', property.id);
      const response = await backendApi.getPropertyHubDocuments(property.id);
      
      if (response && response.documents) {
        setDocuments(response.documents);
        console.log('📄 Loaded documents:', response.documents);
      } else {
        setDocuments([]);
        console.log('📄 No documents found for property');
      }
    } catch (err) {
      console.error('❌ Error loading documents:', err);
      setError('Failed to load documents');
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch {
      return 'Unknown date';
    }
  };

  const getDocumentTypeColor = (type: string) => {
    switch (type) {
      case 'valuation_report':
        return 'bg-green-100 text-green-800';
      case 'market_appraisal':
        return 'bg-blue-100 text-blue-800';
      case 'other_documents':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getDocumentTypeLabel = (type: string) => {
    switch (type) {
      case 'valuation_report':
        return 'Valuation Report';
      case 'market_appraisal':
        return 'Market Appraisal';
      case 'other_documents':
        return 'Other Document';
      default:
        return type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
  };

  if (!isVisible || !property) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 300 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 300 }}
        className="fixed inset-y-0 right-0 w-96 bg-white shadow-2xl z-50 flex flex-col"
        style={{
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Property Details</h2>
            <p className="text-sm text-gray-600 truncate">{property.address}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Property Summary */}
        <div className="p-4 border-b border-gray-200">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-600">Type:</span>
              <span className="ml-2 font-medium">{property.property_type || 'Unknown'}</span>
            </div>
            <div>
              <span className="text-gray-600">Bedrooms:</span>
              <span className="ml-2 font-medium">{property.bedrooms || 0}</span>
            </div>
            <div>
              <span className="text-gray-600">Bathrooms:</span>
              <span className="ml-2 font-medium">{property.bathrooms || 0}</span>
            </div>
            <div>
              <span className="text-gray-600">Size:</span>
              <span className="ml-2 font-medium">{property.square_feet?.toLocaleString() || 'Unknown'} sqft</span>
            </div>
          </div>
          
          {/* Pricing Information */}
          {(property.soldPrice > 0 || property.askingPrice > 0 || property.rentPcm > 0) && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <h3 className="text-sm font-medium text-gray-900 mb-2">Pricing</h3>
              <div className="space-y-1 text-sm">
                {property.soldPrice > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Sold Price:</span>
                    <span className="font-medium">£{property.soldPrice.toLocaleString()}</span>
                  </div>
                )}
                {property.askingPrice > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Asking Price:</span>
                    <span className="font-medium">£{property.askingPrice.toLocaleString()}</span>
                  </div>
                )}
                {property.rentPcm > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Rent PCM:</span>
                    <span className="font-medium">£{property.rentPcm.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Documents Section */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Documents</h3>
            <p className="text-sm text-gray-600">
              {documents.length} document{documents.length !== 1 ? 's' : ''} available
            </p>
          </div>

          {/* Documents List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : error ? (
              <div className="p-4 text-center">
                <p className="text-red-600 text-sm">{error}</p>
                <button
                  onClick={loadPropertyDocuments}
                  className="mt-2 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Retry
                </button>
              </div>
            ) : documents.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                <p className="text-sm">No documents found for this property</p>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {documents.map((doc) => (
                  <DocumentCard
                    key={doc.id}
                    document={doc}
                    onDocumentClick={() => {
                      // TODO: In Phase 2, this will open the document viewer
                      console.log('📄 Document clicked:', doc);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

// Document Card Component
interface DocumentCardProps {
  document: Document;
  onDocumentClick: () => void;
}

const DocumentCard: React.FC<DocumentCardProps> = ({ document, onDocumentClick }) => {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="bg-white border border-gray-200 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
      onClick={onDocumentClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-gray-900 truncate">
            {document.original_filename}
          </h4>
          <div className="flex items-center space-x-2 mt-1">
            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getDocumentTypeColor(document.classification_type)}`}>
              {getDocumentTypeLabel(document.classification_type)}
            </span>
            {document.classification_confidence && (
              <span className="text-xs text-gray-500">
                {Math.round(document.classification_confidence * 100)}% confidence
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Uploaded {formatDate(document.created_at)}
          </p>
        </div>
        <div className="ml-2 flex-shrink-0">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
      </div>
    </motion.div>
  );
};

// Helper functions (moved outside component to avoid recreation)
const getDocumentTypeColor = (type: string) => {
  switch (type) {
    case 'valuation_report':
      return 'bg-green-100 text-green-800';
    case 'market_appraisal':
      return 'bg-blue-100 text-blue-800';
    case 'other_documents':
      return 'bg-gray-100 text-gray-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

const getDocumentTypeLabel = (type: string) => {
  switch (type) {
    case 'valuation_report':
      return 'Valuation Report';
    case 'market_appraisal':
      return 'Market Appraisal';
    case 'other_documents':
      return 'Other Document';
    default:
      return type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
};

const formatDate = (dateString: string) => {
  try {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch {
    return 'Unknown date';
  }
};
