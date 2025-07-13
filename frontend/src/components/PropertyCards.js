import React from 'react';

export default function PropertyCards({ property, comparables = [], onSelectComparable, selectedComparables = [] }) {
  return (
    <div className="flex flex-col gap-8 w-full h-full overflow-y-auto p-6">
      {/* Main Property Card */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 flex flex-col md:flex-row gap-6 p-6 items-center">
        <img
          src={property?.image || '/images/property-placeholder.jpg'}
          alt={property?.address}
          className="w-64 h-48 object-cover rounded-xl border"
        />
        <div className="flex-1 flex flex-col gap-2">
          <h2 className="text-2xl font-bold text-blue-900 mb-1">{property?.address}</h2>
          <div className="text-gray-600 text-base mb-2">{property?.postcode}</div>
          <div className="flex gap-6 text-sm text-gray-700 mb-2">
            <span><b>Type:</b> {property?.property_type}</span>
            <span><b>Bedrooms:</b> {property?.bedrooms}</span>
            <span><b>Bathrooms:</b> {property?.bathrooms}</span>
            <span><b>Area:</b> {property?.floor_area || property?.square_feet} sq ft</span>
          </div>
          <div className="text-lg font-semibold text-blue-700 mb-1">£{property?.price?.toLocaleString() || 'N/A'}</div>
          <div className="text-gray-500 text-sm">{property?.summary}</div>
        </div>
      </div>

      {/* Comparable Properties */}
      <div>
        <h3 className="text-xl font-bold text-gray-800 mb-4">Comparable Properties</h3>
        <div className="flex flex-wrap gap-6">
          {comparables.length === 0 && <div className="text-gray-500">No comparables found.</div>}
          {comparables.map((comp) => (
            <div
              key={comp.id}
              className={`bg-white rounded-xl shadow border border-gray-200 w-72 p-4 flex flex-col gap-2 cursor-pointer transition-all ${selectedComparables.includes(comp.id) ? 'ring-2 ring-blue-500' : ''}`}
              onClick={onSelectComparable ? () => onSelectComparable(comp.id) : undefined}
            >
              <img
                src={comp.image || '/images/property-placeholder.jpg'}
                alt={comp.address}
                className="w-full h-32 object-cover rounded-lg mb-2 border"
              />
              <div className="font-semibold text-base text-blue-900">{comp.address}</div>
              <div className="text-gray-600 text-sm">{comp.postcode}</div>
              <div className="flex gap-3 text-xs text-gray-700 mb-1">
                <span>{comp.bedrooms} bed</span>
                <span>{comp.bathrooms} bath</span>
                <span>{comp.square_feet || comp.floor_area} sq ft</span>
              </div>
              <div className="text-blue-700 font-bold text-lg">£{comp.price?.toLocaleString() || 'N/A'}</div>
              <div className="text-gray-500 text-xs line-clamp-2">{comp.summary}</div>
              {onSelectComparable && (
                <button
                  className={`mt-2 w-full rounded-lg py-1 text-sm font-semibold ${selectedComparables.includes(comp.id) ? 'bg-blue-600 text-white' : 'bg-gray-100 text-blue-700 hover:bg-blue-200'}`}
                >
                  {selectedComparables.includes(comp.id) ? 'Selected' : 'Select Comparable'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
} 