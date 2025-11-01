import React, { useState, useEffect } from 'react';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight, Image as ImageIcon, Eye, Star, Download, RefreshCw, Settings } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';

interface PropertyImage {
  url: string;
  filename: string;
  original_name?: string;
  extracted_at: string;
  page_number?: number;
  dimensions?: string;
  classification?: {
    score: number;
    confidence: number;
    reasons: string[];
    is_property_photo: boolean;
  };
  description?: string;
  storage_provider?: string;
  storage_path?: string;
  size_bytes: number;
  format?: string;
  upload_attempts?: number;
}

interface PropertyImagesProps {
  images: PropertyImage[];
  primaryImageUrl?: string;
  imageCount: number;
  propertyAddress?: string;
  propertyId?: string;
  onSetPrimaryImage?: (imageUrl: string) => void;
  onOptimizeImages?: () => void;
}

export const PropertyImages: React.FC<PropertyImagesProps> = ({ 
  images, 
  primaryImageUrl, 
  imageCount,
  propertyAddress,
  propertyId,
  onSetPrimaryImage,
  onOptimizeImages
}) => {
  const [selectedImage, setSelectedImage] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Auto-select primary image if available
  useEffect(() => {
    if (primaryImageUrl && images.length > 0) {
      const primaryIndex = images.findIndex(img => img.url === primaryImageUrl);
      if (primaryIndex !== -1) {
        setSelectedImage(primaryIndex);
      }
    }
  }, [primaryImageUrl, images]);

  if (imageCount === 0) {
    return (
      <Card className="w-full">
        <CardContent className="p-6">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <ImageIcon className="h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Images Available</h3>
            <p className="text-gray-500">
              No property images were extracted from the document.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentImage = images[selectedImage];
  const imageUrl = currentImage?.url || primaryImageUrl;

  const nextImage = () => {
    setSelectedImage((prev) => (prev + 1) % images.length);
  };

  const prevImage = () => {
    setSelectedImage((prev) => (prev - 1 + images.length) % images.length);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleSetPrimary = () => {
    if (currentImage && onSetPrimaryImage) {
      onSetPrimaryImage(currentImage.url);
    }
  };

  const handleOptimize = async () => {
    if (onOptimizeImages) {
      setIsOptimizing(true);
      try {
        await onOptimizeImages();
      } finally {
        setIsOptimizing(false);
      }
    }
  };

  const getClassificationBadge = (classification?: PropertyImage['classification']) => {
    if (!classification) return null;
    
    const { score, confidence, is_property_photo } = classification;
    const badgeColor = is_property_photo ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800';
    
    return (
      <Badge className={badgeColor}>
        {is_property_photo ? 'Property Photo' : 'Other Image'} ({Math.round(confidence * 100)}%)
      </Badge>
    );
  };

  return (
    <Card className="w-full">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-blue-600" />
            <h3 className="text-lg font-semibold">Property Images</h3>
            <Badge variant="secondary">{imageCount} image{imageCount !== 1 ? 's' : ''}</Badge>
            {currentImage?.classification && getClassificationBadge(currentImage.classification)}
          </div>
          <div className="flex items-center gap-2">
            {images.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsFullscreen(true)}
                className="flex items-center gap-2"
              >
                <Eye className="h-4 w-4" />
                View Fullscreen
              </Button>
            )}
            <Dialog open={showSettings} onOpenChange={setShowSettings}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Image Settings</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <Button
                    onClick={handleSetPrimary}
                    className="w-full flex items-center gap-2"
                    disabled={currentImage?.url === primaryImageUrl}
                  >
                    <Star className="h-4 w-4" />
                    Set as Primary Image
                  </Button>
                  <Button
                    onClick={handleOptimize}
                    className="w-full flex items-center gap-2"
                    disabled={isOptimizing}
                    variant="outline"
                  >
                    <RefreshCw className={`h-4 w-4 ${isOptimizing ? 'animate-spin' : ''}`} />
                    {isOptimizing ? 'Optimizing...' : 'Remove Duplicates'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Main Image Display */}
        <div className="relative mb-4">
          <div className="aspect-video w-full overflow-hidden rounded-lg bg-gray-100">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={`Property image ${selectedImage + 1}`}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = '/placeholder.svg';
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <ImageIcon className="h-12 w-12 text-gray-400" />
              </div>
            )}
          </div>

          {/* Primary Image Indicator */}
          {currentImage?.url === primaryImageUrl && (
            <div className="absolute top-2 left-2 bg-blue-600 text-white px-2 py-1 rounded text-xs flex items-center gap-1">
              <Star className="h-3 w-3" />
              Primary
            </div>
          )}

          {/* Navigation Arrows */}
          {images.length > 1 && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="absolute left-2 top-1/2 transform -translate-y-1/2"
                onClick={prevImage}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="absolute right-2 top-1/2 transform -translate-y-1/2"
                onClick={nextImage}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}

          {/* Image Counter */}
          {images.length > 1 && (
            <div className="absolute bottom-2 right-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
              {selectedImage + 1} / {images.length}
            </div>
          )}
        </div>

        {/* Thumbnail Navigation */}
        {images.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {images.map((image, index) => (
              <button
                key={index}
                onClick={() => setSelectedImage(index)}
                className={`flex-shrink-0 w-16 h-16 rounded overflow-hidden border-2 transition-all relative ${
                  selectedImage === index
                    ? 'border-blue-500 ring-2 ring-blue-200'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <img
                  src={image.url}
                  alt={`Thumbnail ${index + 1}`}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.src = '/placeholder.svg';
                  }}
                />
                {image.url === primaryImageUrl && (
                  <div className="absolute top-0 right-0 bg-blue-600 text-white text-xs px-1 rounded-bl">
                    <Star className="h-2 w-2" />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Enhanced Image Details */}
        {currentImage && (
          <div className="mt-4 p-3 bg-gray-50 rounded-lg">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium text-gray-700">Filename:</span>
                <p className="text-gray-600 truncate">{currentImage.original_name || currentImage.filename}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Size:</span>
                <p className="text-gray-600">{formatFileSize(currentImage.size_bytes)}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Extracted:</span>
                <p className="text-gray-600">
                  {new Date(currentImage.extracted_at).toLocaleDateString()}
                </p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Dimensions:</span>
                <p className="text-gray-600">{currentImage.dimensions || 'Unknown'}</p>
              </div>
              {currentImage.page_number && (
                <div>
                  <span className="font-medium text-gray-700">Page:</span>
                  <p className="text-gray-600">{currentImage.page_number}</p>
                </div>
              )}
              {currentImage.format && (
                <div>
                  <span className="font-medium text-gray-700">Format:</span>
                  <p className="text-gray-600">{currentImage.format.toUpperCase()}</p>
                </div>
              )}
            </div>
            
            {/* Classification Details */}
            {currentImage.classification && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <span className="font-medium text-gray-700">Classification:</span>
                <div className="mt-1">
                  {getClassificationBadge(currentImage.classification)}
                  <p className="text-xs text-gray-500 mt-1">
                    Score: {currentImage.classification.score.toFixed(2)} | 
                    Reasons: {currentImage.classification.reasons.join(', ')}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Property Address */}
        {propertyAddress && (
          <div className="mt-4 p-3 bg-blue-50 rounded-lg">
            <span className="font-medium text-blue-700">Property:</span>
            <p className="text-blue-600">{propertyAddress}</p>
          </div>
        )}
      </CardContent>

      {/* Fullscreen Modal */}
      {isFullscreen && (
        <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4">
          <div className="relative max-w-4xl max-h-full">
            <Button
              variant="outline"
              size="sm"
              className="absolute top-4 right-4 z-10 bg-white"
              onClick={() => setIsFullscreen(false)}
            >
              ✕ Close
            </Button>
            
            {images.length > 1 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute left-4 top-1/2 transform -translate-y-1/2 z-10 bg-white"
                  onClick={prevImage}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute right-4 top-1/2 transform -translate-y-1/2 z-10 bg-white"
                  onClick={nextImage}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}

            <img
              src={imageUrl}
              alt={`Property image ${selectedImage + 1}`}
              className="max-w-full max-h-full object-contain"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = '/placeholder.svg';
              }}
            />

            {images.length > 1 && (
              <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-50 text-white px-3 py-1 rounded">
                {selectedImage + 1} / {images.length}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
};