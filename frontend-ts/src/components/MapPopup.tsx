import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

interface MapPopupProps {
  isOpen: boolean;
  onClose: () => void;
  propertyAddress?: string;
}

// Property coordinates for Bristol properties
const getPropertyCoordinates = (address: string): [number, number] => {
  const coordinates: { [key: string]: [number, number] } = {
    '24 Rudthorpe Rd': [-2.5879, 51.4545], // Central Bristol
    '18 Maple Street': [-2.5900, 51.4500], // Harbourside area
    '42 Oak Avenue': [-2.6000, 51.4600], // Clifton area
    '156 Pine Boulevard': [-2.5700, 51.4400], // Old Market area
  };
  return coordinates[address] || [-2.5879, 51.4545]; // Default to Bristol center
};

export const MapPopup: React.FC<MapPopupProps> = ({ isOpen, onClose, propertyAddress }) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || '';

  useEffect(() => {
    if (!isOpen || !mapContainer.current) return;

    console.log('MapPopup: Initializing map for address:', propertyAddress);

    // Get property coordinates
    const propertyCoords = getPropertyCoordinates(propertyAddress || '');
    console.log('MapPopup: Property coordinates:', propertyCoords);

    // Clean up any existing map first
    if (map.current) {
      map.current.remove();
      map.current = null;
    }

    // Initialize map
    mapboxgl.accessToken = mapboxToken;
    
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: propertyCoords,
      zoom: 10.5, // Match reference image zoom
      bearing: 15, // Match reference angle
      pitch: 45, // Match reference 3D perspective
      antialias: true
    });

    console.log('MapPopup: Map created with colorful style');

    // Add navigation controls
    map.current.addControl(
      new mapboxgl.NavigationControl({
        visualizePitch: true,
      }),
      'top-right'
    );

    // Add a marker for the property
    new mapboxgl.Marker({ color: '#10b981' })
      .setLngLat(propertyCoords)
      .addTo(map.current);

    console.log('MapPopup: Marker added at coordinates:', propertyCoords);

    // Cleanup
    return () => {
      console.log('MapPopup: Cleaning up map');
      map.current?.remove();
      map.current = null;
    };
  }, [isOpen, propertyAddress]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-white rounded-2xl w-full max-w-4xl h-[600px] relative overflow-hidden shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <div>
              <h3 className="text-lg font-semibold text-slate-800">Property Location</h3>
              {propertyAddress && (
                <p className="text-sm text-slate-500">{propertyAddress}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
            >
              <X className="w-5 h-5 text-slate-600" />
            </button>
          </div>

          {/* Map */}
          <div className="flex-1 relative">
            <div ref={mapContainer} className="w-full h-full" />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};