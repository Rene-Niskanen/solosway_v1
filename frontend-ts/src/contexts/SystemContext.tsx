"use client";

import React, { createContext, useContext, useState, useCallback } from 'react';

export interface SystemDocument {
  id: string;
  name: string;
  type: string;
  uploadDate: Date;
  size: string;
  status: 'processed' | 'processing' | 'error';
  propertyAddress?: string;
  location?: {
    lat: number;
    lng: number;
  };
  file: File;
}

export interface SystemActivity {
  id: string;
  action: string;
  documents: string[];
  timestamp: Date;
  type: 'analysis' | 'comparison' | 'valuation' | 'search' | 'upload' | 'deletion';
  details?: any;
}

interface SystemContextType {
  documents: SystemDocument[];
  activities: SystemActivity[];
  addDocument: (file: File, propertyAddress?: string) => string;
  updateDocumentStatus: (id: string, status: SystemDocument['status']) => void;
  deleteDocument: (id: string) => void;
  addActivity: (activity: Omit<SystemActivity, 'id' | 'timestamp'>) => void;
  getDocumentById: (id: string) => SystemDocument | undefined;
  getTotalStorage: () => string;
  getProcessingCount: () => number;
}

const SystemContext = createContext<SystemContextType | undefined>(undefined);

export const useSystem = () => {
  const context = useContext(SystemContext);
  if (!context) {
    throw new Error('useSystem must be used within a SystemProvider');
  }
  return context;
};

export const SystemProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [documents, setDocuments] = useState<SystemDocument[]>([]);
  const [activities, setActivities] = useState<SystemActivity[]>([]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getFileType = (mimeType: string): string => {
    if (mimeType === 'application/pdf') return 'PDF';
    if (mimeType.startsWith('image/')) return 'Image';
    return 'File';
  };

  const generateMockLocation = (): { lat: number; lng: number } => {
    // Generate Sydney CBD area coordinates
    const baseLat = -33.8688;
    const baseLng = 151.2093;
    return {
      lat: baseLat + (Math.random() - 0.5) * 0.02,
      lng: baseLng + (Math.random() - 0.5) * 0.02
    };
  };

  const addDocument = useCallback((file: File, propertyAddress?: string): string => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    
    const newDocument: SystemDocument = {
      id,
      name: file.name,
      type: getFileType(file.type),
      uploadDate: new Date(),
      size: formatFileSize(file.size),
      status: 'processing',
      propertyAddress: propertyAddress || `${Math.floor(Math.random() * 999) + 1} ${['George St', 'Pitt St', 'Market St', 'King St'][Math.floor(Math.random() * 4)]}, Sydney NSW 2000`,
      location: generateMockLocation(),
      file
    };

    setDocuments(prev => [...prev, newDocument]);
    
    // Add upload activity
    addActivity({
      action: `Document "${file.name}" uploaded and processing started`,
      documents: [file.name],
      type: 'upload',
      details: { fileSize: formatFileSize(file.size), fileType: getFileType(file.type) }
    });

    // Simulate processing completion
    setTimeout(() => {
      updateDocumentStatus(id, 'processed');
    }, 2000 + Math.random() * 3000);

    return id;
  }, []);

  const updateDocumentStatus = useCallback((id: string, status: SystemDocument['status']) => {
    setDocuments(prev => prev.map(doc => 
      doc.id === id ? { ...doc, status } : doc
    ));

    const document = documents.find(doc => doc.id === id);
    if (document && status === 'processed') {
      addActivity({
        action: `Document "${document.name}" successfully processed and indexed`,
        documents: [document.name],
        type: 'analysis',
        details: { processingTime: '2.3s', extractedPages: Math.floor(Math.random() * 10) + 1 }
      });
    }
  }, [documents]);

  const deleteDocument = useCallback((id: string) => {
    const document = documents.find(doc => doc.id === id);
    if (document) {
      setDocuments(prev => prev.filter(doc => doc.id !== id));
      addActivity({
        action: `Document "${document.name}" removed from system`,
        documents: [document.name],
        type: 'deletion',
        details: { reason: 'User deletion', freedSpace: document.size }
      });
    }
  }, [documents]);

  const addActivity = useCallback((activity: Omit<SystemActivity, 'id' | 'timestamp'>) => {
    const newActivity: SystemActivity = {
      ...activity,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      timestamp: new Date()
    };

    setActivities(prev => [newActivity, ...prev].slice(0, 50)); // Keep last 50 activities
  }, []);

  const getDocumentById = useCallback((id: string) => {
    return documents.find(doc => doc.id === id);
  }, [documents]);

  const getTotalStorage = useCallback(() => {
    const totalBytes = documents.reduce((total, doc) => {
      // Convert size back to bytes for calculation (rough estimation)
      const sizeStr = doc.size;
      const value = parseFloat(sizeStr);
      const unit = sizeStr.split(' ')[1];
      
      let bytes = value;
      switch (unit) {
        case 'KB': bytes *= 1024; break;
        case 'MB': bytes *= 1024 * 1024; break;
        case 'GB': bytes *= 1024 * 1024 * 1024; break;
      }
      return total + bytes;
    }, 0);
    
    return formatFileSize(totalBytes);
  }, [documents]);

  const getProcessingCount = useCallback(() => {
    return documents.filter(doc => doc.status === 'processing').length;
  }, [documents]);

  return (
    <SystemContext.Provider value={{
      documents,
      activities,
      addDocument,
      updateDocumentStatus,
      deleteDocument,
      addActivity,
      getDocumentById,
      getTotalStorage,
      getProcessingCount
    }}>
      {children}
    </SystemContext.Provider>
  );
};