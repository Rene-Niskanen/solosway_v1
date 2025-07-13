import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BaseLayout from './BaseLayout';

const CreateAppraisal = ({ user }) => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    address: '',
    bedrooms: '',
    bathrooms: '',
    property_type: '',
    land_size: '',
    floor_area: '',
    condition: '',
    features: []
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleCheckboxChange = (e) => {
    const { value, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      features: checked 
        ? [...prev.features, value]
        : prev.features.filter(feature => feature !== value)
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/appraisal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (response.ok) {
        // Redirect to the new appraisal
        navigate(`/appraisal/${data.appraisal_id}`);
      } else {
        setError(data.error || 'Failed to create appraisal');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BaseLayout user={user}>
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] w-full bg-[#f7f9fb] py-8 px-4">
        <div className="w-full max-w-5xl bg-white rounded-2xl shadow-xl p-10 flex flex-col gap-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-[#0d141c] text-3xl font-bold leading-tight mb-1">Start Valuation</p>
              <p className="text-[#49719c] text-base font-normal leading-normal">Enter the property details to begin your valuation.</p>
            </div>
          </div>
          {error && (
            <div className="mx-4 mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col gap-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <label className="flex flex-col gap-2">
                <span className="text-[#0d141c] text-base font-medium leading-normal">Address</span>
                <input
                  name="address"
                  value={formData.address}
                  onChange={handleInputChange}
                  placeholder="Enter property address"
                  className="form-input w-full rounded-xl text-[#0d141c] border-none bg-[#e7edf4] h-14 placeholder:text-[#49719c] p-4 text-base font-normal focus:outline-0 focus:ring-0 focus:border-none"
                  required
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-[#0d141c] text-base font-medium leading-normal">Property Type</span>
                <select
                  name="property_type"
                  value={formData.property_type}
                  onChange={handleInputChange}
                  className="form-input w-full rounded-xl text-[#0d141c] border-none bg-[#e7edf4] h-14 placeholder:text-[#49719c] p-4 text-base font-normal focus:outline-0 focus:ring-0 focus:border-none"
                >
                  <option value="">Select</option>
                  <option value="house">House</option>
                  <option value="apartment">Apartment</option>
                  <option value="townhouse">Townhouse</option>
                </select>
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-[#0d141c] text-base font-medium leading-normal">Bedrooms</span>
                <input
                  name="bedrooms"
                  type="number"
                  value={formData.bedrooms}
                  onChange={handleInputChange}
                  placeholder="Select"
                  className="form-input w-full rounded-xl text-[#0d141c] border-none bg-[#e7edf4] h-14 placeholder:text-[#49719c] p-4 text-base font-normal focus:outline-0 focus:ring-0 focus:border-none"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-[#0d141c] text-base font-medium leading-normal">Bathrooms</span>
                <input
                  name="bathrooms"
                  type="number"
                  value={formData.bathrooms}
                  onChange={handleInputChange}
                  placeholder="Select"
                  className="form-input w-full rounded-xl text-[#0d141c] border-none bg-[#e7edf4] h-14 placeholder:text-[#49719c] p-4 text-base font-normal focus:outline-0 focus:ring-0 focus:border-none"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-[#0d141c] text-base font-medium leading-normal">Land Size (Acres)</span>
                <input
                  name="land_size"
                  type="number"
                  step="0.01"
                  value={formData.land_size}
                  onChange={handleInputChange}
                  placeholder="Enter land size"
                  className="form-input w-full rounded-xl text-[#0d141c] border-none bg-[#e7edf4] h-14 placeholder:text-[#49719c] p-4 text-base font-normal focus:outline-0 focus:ring-0 focus:border-none"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-[#0d141c] text-base font-medium leading-normal">Floor Area (sq ft)</span>
                <input
                  name="floor_area"
                  type="number"
                  step="0.01"
                  value={formData.floor_area}
                  onChange={handleInputChange}
                  placeholder="Enter floor area"
                  className="form-input w-full rounded-xl text-[#0d141c] border-none bg-[#e7edf4] h-14 placeholder:text-[#49719c] p-4 text-base font-normal focus:outline-0 focus:ring-0 focus:border-none"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-[#0d141c] text-base font-medium leading-normal">Condition (1-10)</span>
                <select
                  name="condition"
                  value={formData.condition}
                  onChange={handleInputChange}
                  className="form-input w-full rounded-xl text-[#0d141c] border-none bg-[#e7edf4] h-14 placeholder:text-[#49719c] p-4 text-base font-normal focus:outline-0 focus:ring-0 focus:border-none"
                >
                  <option value="">Select</option>
                  {[...Array(10)].map((_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}</option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <h3 className="text-[#0d141c] text-lg font-bold leading-tight tracking-[-0.015em] pb-2 pt-4">External Features</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { value: 'garage', label: 'Parking (Garage)' },
                  { value: 'carport', label: 'Parking (Carport)' },
                  { value: 'off_street', label: 'Parking (Off-street)' },
                  { value: 'pool', label: 'Swimming Pool' },
                  { value: 'garden', label: 'Garden / Landscaping' },
                  { value: 'balcony', label: 'Balconies, Terraces, Patios' },
                  { value: 'security', label: 'Security Systems (CCTV, Alarms, Gates)' },
                ].map(feature => (
                  <label key={feature.value} className="flex items-center gap-x-3 py-2">
                    <input
                      type="checkbox"
                      name="features"
                      value={feature.value}
                      checked={formData.features.includes(feature.value)}
                      onChange={handleCheckboxChange}
                      className="h-5 w-5 rounded border-[#cedbe8] border-2 bg-transparent text-[#3490f3] checked:bg-[#3490f3] checked:border-[#3490f3] focus:ring-0 focus:ring-offset-0 focus:border-[#cedbe8] focus:outline-none"
                    />
                    <span className="text-[#0d141c] text-base font-normal leading-normal">{feature.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex min-w-[120px] max-w-xs cursor-pointer items-center justify-center overflow-hidden rounded-full h-12 px-8 bg-[#3490f3] text-slate-50 text-base font-bold leading-normal tracking-[0.015em] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="truncate">
                  {isSubmitting ? 'Creating...' : 'Start Valuation'}
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </BaseLayout>
  );
};

export default CreateAppraisal; 