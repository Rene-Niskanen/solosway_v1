import React, { useRef, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

interface SystemDocument {
  id: string;
  name: string;
  propertyAddress?: string;
  location?: { lat: number; lng: number };
  status: string;
  size: string;
}

interface DocumentMappingProps {
  documents: SystemDocument[];
  onDocumentSelect: (doc: SystemDocument) => void;
  onDocumentDelete: (id: string) => void;
}

export default function DocumentMapping({ 
  documents, 
  onDocumentSelect, 
  onDocumentDelete 
}: DocumentMappingProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
  const markers = useRef<mapboxgl.Marker[]>([]);

  // Initialize map when component mounts
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    mapboxgl.accessToken = mapboxToken;
    
    try {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [-2.5879, 51.4545], // Bristol, UK
        zoom: 11,
        antialias: true
      });

      // Add navigation controls
      map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

      // Add some sample markers for demonstration
      const sampleLocations = [
        { lat: 51.4545, lng: -2.5879, name: 'Central Bristol', status: 'processed' },
        { lat: 51.4500, lng: -2.5900, name: 'Harbourside', status: 'processing' },
        { lat: 51.4600, lng: -2.6000, name: 'Clifton', status: 'processed' },
        { lat: 51.4400, lng: -2.5700, name: 'Old Market', status: 'error' }
      ];

      sampleLocations.forEach((location) => {
        const el = document.createElement('div');
        el.className = `w-4 h-4 rounded-full border-2 border-white shadow-lg cursor-pointer ${
          location.status === 'processed' ? 'bg-emerald-500' : 
          location.status === 'processing' ? 'bg-amber-500' : 'bg-red-500'
        }`;
        
        const marker = new mapboxgl.Marker(el)
          .setLngLat([location.lng, location.lat])
          .setPopup(new mapboxgl.Popup().setHTML(`
            <div class="p-2">
              <h3 class="font-semibold text-sm">${location.name}</h3>
              <p class="text-xs text-slate-500">Status: ${location.status}</p>
            </div>
          `))
          .addTo(map.current);

        markers.current.push(marker);
      });

    } catch (error) {
      console.error('Failed to initialize map:', error);
    }

    return () => {
      markers.current.forEach(marker => marker.remove());
      markers.current = [];
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // Update markers when documents change
  useEffect(() => {
    if (!map.current) return;

    documents.forEach((doc) => {
      if (doc.location && doc.location.lat && doc.location.lng) {
        const el = document.createElement('div');
        el.className = `w-4 h-4 rounded-full border-2 border-white shadow-lg cursor-pointer ${
          doc.status === 'processed' ? 'bg-emerald-500' : 
          doc.status === 'processing' ? 'bg-amber-500' : 'bg-red-500'
        }`;
        
        const marker = new mapboxgl.Marker(el)
          .setLngLat([doc.location.lng, doc.location.lat])
          .setPopup(new mapboxgl.Popup().setHTML(`
            <div class="p-2">
              <h3 class="font-semibold text-sm">${doc.name}</h3>
              <p class="text-xs text-slate-600">${doc.propertyAddress || 'No address'}</p>
              <p class="text-xs text-slate-500">Status: ${doc.status}</p>
            </div>
          `))
          .addTo(map.current);

        marker.getElement().addEventListener('click', () => {
          onDocumentSelect(doc);
        });

        markers.current.push(marker);
      }
    });
  }, [documents, onDocumentSelect]);

  return (
    <div className="w-full h-full relative">
      <div 
        ref={mapContainer} 
        className="w-full h-full bg-slate-200"
        style={{ minHeight: '100vh' }}
      />
      
      {/* Map overlay info */}
      <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg p-2 text-xs text-slate-600">
        Bristol Property Map • Satellite View
      </div>
    </div>
  );
}