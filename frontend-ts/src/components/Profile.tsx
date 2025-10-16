"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Camera, User, Mail, Phone, MapPin, Calendar, Edit3, Save, X, Bell, Settings, Shield, Eye, EyeOff, Globe, Moon, Sun, Volume2, VolumeX, Smartphone, Monitor, Laptop } from "lucide-react";

interface ProfileData {
  // Basic Information
  name: string;
  email: string;
  phone: string;
  location: string;
  joinDate: string;
  profileImage: string;
  
  // Account Settings
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
    propertyAlerts: boolean;
    priceChanges: boolean;
    newListings: boolean;
  };
  
  // Privacy Settings
  privacy: {
    profileVisibility: 'public' | 'private' | 'contacts';
    showActivity: boolean;
    allowDataCollection: boolean;
    shareSearchHistory: boolean;
  };
  
  // Display Preferences
  display: {
    theme: 'light' | 'dark' | 'auto';
    currency: 'GBP' | 'USD' | 'EUR';
    distanceUnit: 'miles' | 'km';
    language: 'en' | 'es' | 'fr' | 'de';
  };
  
  // Search Preferences
  searchPreferences: {
    defaultSearchRadius: number; // in miles/km
    maxPrice: number;
    minPrice: number;
    propertyTypes: string[];
    bedrooms: number;
    bathrooms: number;
  };
}

interface ProfileProps {
  onNavigate?: (view: string, options?: { showMap?: boolean }) => void;
}

const Profile: React.FC<ProfileProps> = ({ onNavigate }) => {
  // Load profile data from localStorage or use defaults
  const getInitialProfileData = (): ProfileData => {
    const saved = localStorage.getItem('velora-profile-data');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (error) {
        console.error('Error parsing saved profile data:', error);
      }
    }
    return {
      // Basic Information
      name: "Alex Thompson",
      email: "alex.thompson@email.com",
      phone: "+44 7700 900123",
      location: "Bristol, UK",
      joinDate: "March 2024",
      profileImage: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop&crop=face",
      
      // Account Settings
      notifications: {
        email: true,
        push: true,
        sms: false,
        propertyAlerts: true,
        priceChanges: true,
        newListings: true,
      },
      
      // Privacy Settings
      privacy: {
        profileVisibility: 'private',
        showActivity: false,
        allowDataCollection: true,
        shareSearchHistory: false,
      },
      
      // Display Preferences
      display: {
        theme: 'dark',
        currency: 'GBP',
        distanceUnit: 'miles',
        language: 'en',
      },
      
      // Search Preferences
      searchPreferences: {
        defaultSearchRadius: 10,
        maxPrice: 500000,
        minPrice: 200000,
        propertyTypes: ['house', 'flat', 'apartment'],
        bedrooms: 3,
        bathrooms: 2,
      }
    };
  };

  const [profileData, setProfileData] = React.useState<ProfileData>(getInitialProfileData);
  const [activeTab, setActiveTab] = React.useState<'profile' | 'notifications' | 'privacy' | 'display' | 'search'>('profile');
  const [isEditing, setIsEditing] = React.useState(false);
  const [editData, setEditData] = React.useState<ProfileData>(getInitialProfileData);
  const [showEmailNotification, setShowEmailNotification] = React.useState(false);
  const [showPhoneNotification, setShowPhoneNotification] = React.useState(false);
  const [emailChangeAttempted, setEmailChangeAttempted] = React.useState(false);
  const [phoneChangeAttempted, setPhoneChangeAttempted] = React.useState(false);

  // Load profile data from localStorage on component mount
  React.useEffect(() => {
    const saved = localStorage.getItem('velora-profile-data');
    if (saved) {
      try {
        const parsedData = JSON.parse(saved);
        setProfileData(parsedData);
        setEditData(parsedData);
      } catch (error) {
        console.error('Error loading saved profile data:', error);
      }
    }
  }, []);

  const handleEdit = () => {
    setEditData(profileData);
    setIsEditing(true);
    // Reset change attempts when starting to edit
    setEmailChangeAttempted(false);
    setPhoneChangeAttempted(false);
  };

  const handleSave = () => {
    setProfileData(editData);
    localStorage.setItem('velora-profile-data', JSON.stringify(editData));
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditData(profileData);
    setIsEditing(false);
    setEmailChangeAttempted(false);
    setPhoneChangeAttempted(false);
  };

  const handleSettingChange = (section: keyof ProfileData, key: string, value: any) => {
    if (isEditing) {
      setEditData({
        ...editData,
        [section]: {
          ...editData[section as keyof ProfileData],
          [key]: value
        }
      });
    } else {
      const updatedData = {
        ...profileData,
        [section]: {
          ...profileData[section as keyof ProfileData],
          [key]: value
        }
      };
      setProfileData(updatedData);
      localStorage.setItem('velora-profile-data', JSON.stringify(updatedData));
    }
  };


  const Card = ({ children, className = "", ...props }: any) => (
    <div
      className={`bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20 shadow-2xl p-6 ${className}`}
      style={{
        background: 'rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1)'
      }}
      {...props}
    >
      {children}
    </div>
  );

  const ToggleSwitch = ({ checked, onChange, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) => (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 ${
        checked ? 'bg-blue-600' : 'bg-gray-600'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );

  const Select = ({ value, onChange, options, disabled = false }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; disabled?: boolean }) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full px-3 py-2 bg-white/20 border border-white/30 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent backdrop-blur-sm disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-gray-800 text-white">
          {option.label}
        </option>
      ))}
    </select>
  );

  const NotificationBanner = ({ message, onClose, type = 'warning' }: { message: string; onClose: () => void; type?: 'warning' | 'info' }) => (
    <div className={`fixed top-4 right-4 z-50 max-w-sm bg-white/10 backdrop-blur-xl border border-white/20 rounded-lg shadow-2xl p-4 transition-all duration-300 ${
      type === 'warning' ? 'border-yellow-400/50' : 'border-blue-400/50'
    }`}>
      <div className="flex items-start space-x-3">
        <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
          type === 'warning' ? 'bg-yellow-500/20' : 'bg-blue-500/20'
        }`}>
          <div className={`w-2 h-2 rounded-full ${
            type === 'warning' ? 'bg-yellow-400' : 'bg-blue-400'
          }`} />
        </div>
        <div className="flex-1">
          <p className="text-white text-sm font-medium">{message}</p>
        </div>
        <button
          onClick={onClose}
          className="flex-shrink-0 text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  const handleFieldChange = (field: keyof ProfileData, value: string) => {
    if (!isEditing) return;
    
    // Show notifications for sensitive fields
    if (field === 'email' && !emailChangeAttempted) {
      setShowEmailNotification(true);
      setEmailChangeAttempted(true);
      setTimeout(() => setShowEmailNotification(false), 5000);
    }
    
    if (field === 'phone' && !phoneChangeAttempted) {
      setShowPhoneNotification(true);
      setPhoneChangeAttempted(true);
      setTimeout(() => setShowPhoneNotification(false), 5000);
    }
    
    setEditData(prev => ({ ...prev, [field]: value }));
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (isEditing) {
          setEditData(prev => ({ ...prev, profileImage: e.target?.result as string }));
        } else {
          const updatedData = { ...profileData, profileImage: e.target?.result as string };
          setProfileData(updatedData);
          setEditData(updatedData);
          localStorage.setItem('velora-profile-data', JSON.stringify(updatedData));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-800 via-green-900 to-emerald-900 overflow-y-auto">
      {/* Notification Banners */}
      {showEmailNotification && (
        <NotificationBanner
          message="Email changes require approval. Your account cannot be changed again for another 3 days until it has been approved."
          onClose={() => setShowEmailNotification(false)}
          type="warning"
        />
      )}
      {showPhoneNotification && (
        <NotificationBanner
          message="Phone number changes require approval. Your account cannot be changed again for another 3 days until it has been approved."
          onClose={() => setShowPhoneNotification(false)}
          type="warning"
        />
      )}
      
      <div className="w-full min-h-screen py-8 pl-6 pr-8 ml-14 lg:ml-16">
        <div className="w-full max-w-6xl mx-auto">
          
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Account Settings</h1>
            <p className="text-gray-300">Manage your account preferences and settings</p>
          </div>

          {/* Tab Navigation */}
          <div className="mb-8">
            <div className="flex space-x-1 bg-white/10 backdrop-blur-sm rounded-lg p-1">
              {[
                { id: 'profile', label: 'Profile', icon: User },
                { id: 'notifications', label: 'Notifications', icon: Bell },
                { id: 'privacy', label: 'Privacy', icon: Shield },
                { id: 'display', label: 'Display', icon: Monitor },
                { id: 'search', label: 'Search', icon: Settings }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'bg-white/20 text-white'
                      : 'text-gray-300 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <tab.icon className="w-4 h-4 mr-2" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Content */}
          <Card>
            {activeTab === 'profile' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-white">Profile Information</h2>
                  <div className="flex space-x-2">
                    {!isEditing ? (
                      <button
                        onClick={handleEdit}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                      >
                        <Edit3 className="w-4 h-4 mr-2 inline" />
                        Edit
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={handleSave}
                          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                          <Save className="w-4 h-4 mr-2 inline" />
                          Save
                        </button>
                        <button
                          onClick={handleCancel}
                          className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                          <X className="w-4 h-4 mr-2 inline" />
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-start space-x-6">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-xl overflow-hidden bg-gradient-to-br from-blue-400 to-purple-500 shadow-lg">
                      <img
                        src={editData.profileImage}
                        alt="Profile"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    {isEditing && (
                      <label className="absolute bottom-1 right-1 bg-blue-600 hover:bg-blue-700 text-white p-1.5 rounded-full cursor-pointer transition-colors">
                        <Camera className="w-3 h-3" />
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>

                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
                      <input
                        type="text"
                        value={editData.name}
                        onChange={(e) => handleFieldChange('name', e.target.value)}
                        readOnly={!isEditing}
                        className={`w-full px-3 py-2 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent backdrop-blur-sm ${
                          isEditing 
                            ? 'bg-white/20 border-white/30' 
                            : 'bg-transparent border-transparent cursor-default'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                      <input
                        type="email"
                        value={editData.email}
                        onChange={(e) => handleFieldChange('email', e.target.value)}
                        readOnly={!isEditing}
                        className={`w-full px-3 py-2 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent backdrop-blur-sm ${
                          isEditing 
                            ? 'bg-white/20 border-white/30' 
                            : 'bg-transparent border-transparent cursor-default'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Phone</label>
                      <input
                        type="tel"
                        value={editData.phone}
                        onChange={(e) => handleFieldChange('phone', e.target.value)}
                        readOnly={!isEditing}
                        className={`w-full px-3 py-2 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent backdrop-blur-sm ${
                          isEditing 
                            ? 'bg-white/20 border-white/30' 
                            : 'bg-transparent border-transparent cursor-default'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Location</label>
                      <input
                        type="text"
                        value={editData.location}
                        onChange={(e) => handleFieldChange('location', e.target.value)}
                        readOnly={!isEditing}
                        className={`w-full px-3 py-2 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent backdrop-blur-sm ${
                          isEditing 
                            ? 'bg-white/20 border-white/30' 
                            : 'bg-transparent border-transparent cursor-default'
                        }`}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center text-gray-300 pt-4 border-t border-white/20">
                  <Calendar className="w-4 h-4 mr-2" />
                  <span className="text-sm">Member since {profileData.joinDate}</span>
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold text-white">Notification Preferences</h2>
                <div className="space-y-4">
                  {Object.entries(profileData.notifications).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between p-4 bg-white/10 rounded-lg">
                      <div>
                        <h3 className="text-white font-medium capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</h3>
                        <p className="text-gray-300 text-sm">
                          {key === 'email' && 'Receive notifications via email'}
                          {key === 'push' && 'Receive push notifications in browser'}
                          {key === 'sms' && 'Receive SMS notifications'}
                          {key === 'propertyAlerts' && 'Get alerts for new properties matching your criteria'}
                          {key === 'priceChanges' && 'Get notified when property prices change'}
                          {key === 'newListings' && 'Get notified about new listings in your areas'}
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={value}
                        onChange={(checked) => handleSettingChange('notifications', key, checked)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'privacy' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold text-white">Privacy Settings</h2>
                <div className="space-y-4">
                  <div className="p-4 bg-white/10 rounded-lg">
                    <h3 className="text-white font-medium mb-2">Profile Visibility</h3>
                    <p className="text-gray-300 text-sm mb-3">Control who can see your profile information</p>
                    <Select
                      value={profileData.privacy.profileVisibility}
                      onChange={(value) => handleSettingChange('privacy', 'profileVisibility', value)}
                      options={[
                        { value: 'public', label: 'Public - Everyone can see your profile' },
                        { value: 'contacts', label: 'Contacts - Only people you connect with' },
                        { value: 'private', label: 'Private - Only you can see your profile' }
                      ]}
                    />
                  </div>

                  {Object.entries(profileData.privacy).filter(([key]) => key !== 'profileVisibility').map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between p-4 bg-white/10 rounded-lg">
                      <div>
                        <h3 className="text-white font-medium capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</h3>
                        <p className="text-gray-300 text-sm">
                          {key === 'showActivity' && 'Allow others to see your search activity'}
                          {key === 'allowDataCollection' && 'Help improve our service by sharing anonymous usage data'}
                          {key === 'shareSearchHistory' && 'Share your search history for better recommendations'}
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={value as boolean}
                        onChange={(checked) => handleSettingChange('privacy', key, checked)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'display' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold text-white">Display Preferences</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Theme</label>
                      <Select
                        value={profileData.display.theme}
                        onChange={(value) => handleSettingChange('display', 'theme', value)}
                        options={[
                          { value: 'light', label: 'Light' },
                          { value: 'dark', label: 'Dark' },
                          { value: 'auto', label: 'Auto (System)' }
                        ]}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Currency</label>
                      <Select
                        value={profileData.display.currency}
                        onChange={(value) => handleSettingChange('display', 'currency', value)}
                        options={[
                          { value: 'GBP', label: 'British Pound (£)' },
                          { value: 'USD', label: 'US Dollar ($)' },
                          { value: 'EUR', label: 'Euro (€)' }
                        ]}
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Distance Unit</label>
                      <Select
                        value={profileData.display.distanceUnit}
                        onChange={(value) => handleSettingChange('display', 'distanceUnit', value)}
                        options={[
                          { value: 'miles', label: 'Miles' },
                          { value: 'km', label: 'Kilometers' }
                        ]}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Language</label>
                      <Select
                        value={profileData.display.language}
                        onChange={(value) => handleSettingChange('display', 'language', value)}
                        options={[
                          { value: 'en', label: 'English' },
                          { value: 'es', label: 'Spanish' },
                          { value: 'fr', label: 'French' },
                          { value: 'de', label: 'German' }
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'search' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold text-white">Search Preferences</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Default Search Radius</label>
                      <input
                        type="number"
                        value={profileData.searchPreferences.defaultSearchRadius}
                        onChange={(e) => handleSettingChange('searchPreferences', 'defaultSearchRadius', parseInt(e.target.value))}
                        className="w-full px-3 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent backdrop-blur-sm"
                        min="1"
                        max="50"
                      />
                      <p className="text-gray-400 text-xs mt-1">Miles from search location</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Minimum Price</label>
                      <input
                        type="number"
                        value={profileData.searchPreferences.minPrice}
                        onChange={(e) => handleSettingChange('searchPreferences', 'minPrice', parseInt(e.target.value))}
                        className="w-full px-3 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent backdrop-blur-sm"
                        min="0"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Maximum Price</label>
                      <input
                        type="number"
                        value={profileData.searchPreferences.maxPrice}
                        onChange={(e) => handleSettingChange('searchPreferences', 'maxPrice', parseInt(e.target.value))}
                        className="w-full px-3 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent backdrop-blur-sm"
                        min="0"
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Bedrooms</label>
                      <input
                        type="number"
                        value={profileData.searchPreferences.bedrooms}
                        onChange={(e) => handleSettingChange('searchPreferences', 'bedrooms', parseInt(e.target.value))}
                        className="w-full px-3 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent backdrop-blur-sm"
                        min="1"
                        max="10"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Bathrooms</label>
                      <input
                        type="number"
                        value={profileData.searchPreferences.bathrooms}
                        onChange={(e) => handleSettingChange('searchPreferences', 'bathrooms', parseInt(e.target.value))}
                        className="w-full px-3 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent backdrop-blur-sm"
                        min="1"
                        max="10"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Property Types</label>
                      <div className="space-y-2">
                        {['house', 'flat', 'apartment', 'bungalow', 'cottage'].map((type) => (
                          <label key={type} className="flex items-center">
                            <input
                              type="checkbox"
                              checked={profileData.searchPreferences.propertyTypes.includes(type)}
                              onChange={(e) => {
                                const newTypes = e.target.checked
                                  ? [...profileData.searchPreferences.propertyTypes, type]
                                  : profileData.searchPreferences.propertyTypes.filter(t => t !== type);
                                handleSettingChange('searchPreferences', 'propertyTypes', newTypes);
                              }}
                              className="mr-2 rounded border-white/30 bg-white/20 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-white capitalize">{type}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Profile;
