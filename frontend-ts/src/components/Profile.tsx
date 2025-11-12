"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Camera, Bell, Search, ChevronDown, Mail } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

interface ProfileData {
  // Basic Information
  name: string;
  email: string;
  phone: string;
  location: string;
  joinDate: string;
  profileImage: string;
  fullName: string;
  nickName: string;
  gender: string;
  language: string;
  country: string;
  timeZone: string;
  
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
    defaultSearchRadius: number;
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
      name: "Alexa Rawles",
      email: "alexarawles@gmail.com",
      phone: "+44 7700 900123",
      location: "Bristol, UK",
      joinDate: "March 2024",
      profileImage: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop&crop=face",
      fullName: "Alexa Rawles",
      nickName: "Alexa",
      gender: "Female",
      language: "English",
      country: "United Kingdom",
      timeZone: "GMT+0 (London)",
      notifications: {
        email: true,
        push: true,
        sms: false,
        propertyAlerts: true,
        priceChanges: true,
        newListings: true,
      },
      privacy: {
        profileVisibility: 'private',
        showActivity: false,
        allowDataCollection: true,
        shareSearchHistory: false,
      },
      display: {
        theme: 'light',
        currency: 'GBP',
        distanceUnit: 'miles',
        language: 'en',
      },
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
  const [isEditing, setIsEditing] = React.useState(false);
  const [editData, setEditData] = React.useState<ProfileData>(getInitialProfileData);

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
  };

  const handleSave = () => {
    setProfileData(editData);
    localStorage.setItem('velora-profile-data', JSON.stringify(editData));
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditData(profileData);
    setIsEditing(false);
  };

  const handleFieldChange = (field: keyof ProfileData, value: string) => {
    if (!isEditing) return;
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

  // Get current date
  const getCurrentDate = () => {
    const date = new Date();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  };

  // Get user name for welcome message
  const getUserName = () => {
    return profileData.name.split(' ')[0] || 'User';
  };

  return (
    <div className="min-h-screen w-full bg-gray-50">
      {/* Header Section */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Left: Welcome Message */}
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Welcome, {getUserName()}</h1>
              <p className="text-sm text-gray-500 mt-1">{getCurrentDate()}</p>
            </div>

            {/* Right: Search, Bell */}
            <div className="flex items-center gap-3">
              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search"
                  className="pl-10 pr-4 py-2.5 w-64 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>

              {/* Bell Icon */}
              <button className="relative p-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
                <Bell className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Profile Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-white rounded-xl shadow-md border border-gray-200 p-8"
        >
          {/* User Identity Section */}
          <div className="flex items-center justify-between mb-8 pb-8 border-b border-gray-200">
            <div className="flex items-center gap-6">
              {/* Profile Picture */}
              <div className="relative group">
                <Avatar className="w-24 h-24 ring-2 ring-gray-100">
                  <AvatarImage src={editData.profileImage} alt={profileData.name} className="object-cover" />
                  <AvatarFallback className="bg-gradient-to-br from-blue-400 to-purple-500 text-white text-2xl font-semibold">
                    {profileData.name.split(' ').map(n => n[0]).join('')}
                  </AvatarFallback>
                </Avatar>
                {isEditing && (
                  <label className="absolute bottom-0 right-0 bg-blue-600 hover:bg-blue-700 text-white p-2.5 rounded-full cursor-pointer transition-all shadow-lg hover:shadow-xl hover:scale-105">
                    <Camera className="w-4 h-4" />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {/* Name and Email */}
              <div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-1">{editData.name}</h2>
                <p className="text-sm text-gray-500">{editData.email}</p>
              </div>
            </div>

            {/* Edit Button */}
            {!isEditing ? (
              <button
                onClick={handleEdit}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-all shadow-sm hover:shadow-md"
              >
                Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-all shadow-sm hover:shadow-md"
                >
                  Save
                </button>
                <button
                  onClick={handleCancel}
                  className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-all"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Profile Information Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {/* Left Column */}
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2.5">Full Name</label>
                <input
                  type="text"
                  value={editData.fullName}
                  onChange={(e) => handleFieldChange('fullName', e.target.value)}
                  readOnly={!isEditing}
                  placeholder="Your First Name"
                  className={`w-full px-4 py-2.5 border rounded-lg text-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    isEditing 
                      ? 'bg-white border-gray-300 text-gray-900 hover:border-gray-400' 
                      : 'bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed'
                  }`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2.5">Gender</label>
                <div className="relative">
                  <select
                    value={editData.gender}
                    onChange={(e) => handleFieldChange('gender', e.target.value)}
                    disabled={!isEditing}
                    className={`w-full px-4 py-2.5 border rounded-lg text-sm appearance-none transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      isEditing 
                        ? 'bg-white border-gray-300 text-gray-900 cursor-pointer hover:border-gray-400' 
                        : 'bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                  <ChevronDown className={`absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none ${!isEditing ? 'opacity-50' : ''}`} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2.5">Language</label>
                <div className="relative">
                  <select
                    value={editData.language}
                    onChange={(e) => handleFieldChange('language', e.target.value)}
                    disabled={!isEditing}
                    className={`w-full px-4 py-2.5 border rounded-lg text-sm appearance-none transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      isEditing 
                        ? 'bg-white border-gray-300 text-gray-900 cursor-pointer hover:border-gray-400' 
                        : 'bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    <option value="English">English</option>
                    <option value="Spanish">Spanish</option>
                    <option value="French">French</option>
                    <option value="German">German</option>
                  </select>
                  <ChevronDown className={`absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none ${!isEditing ? 'opacity-50' : ''}`} />
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2.5">Nick Name</label>
                <input
                  type="text"
                  value={editData.nickName}
                  onChange={(e) => handleFieldChange('nickName', e.target.value)}
                  readOnly={!isEditing}
                  placeholder="Your First Name"
                  className={`w-full px-4 py-2.5 border rounded-lg text-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    isEditing 
                      ? 'bg-white border-gray-300 text-gray-900 hover:border-gray-400' 
                      : 'bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed'
                  }`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2.5">Country</label>
                <div className="relative">
                  <select
                    value={editData.country}
                    onChange={(e) => handleFieldChange('country', e.target.value)}
                    disabled={!isEditing}
                    className={`w-full px-4 py-2.5 border rounded-lg text-sm appearance-none transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      isEditing 
                        ? 'bg-white border-gray-300 text-gray-900 cursor-pointer hover:border-gray-400' 
                        : 'bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    <option value="United Kingdom">United Kingdom</option>
                    <option value="United States">United States</option>
                    <option value="Canada">Canada</option>
                    <option value="Australia">Australia</option>
                    <option value="Germany">Germany</option>
                    <option value="France">France</option>
                  </select>
                  <ChevronDown className={`absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none ${!isEditing ? 'opacity-50' : ''}`} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2.5">Time Zone</label>
                <div className="relative">
                  <select
                    value={editData.timeZone}
                    onChange={(e) => handleFieldChange('timeZone', e.target.value)}
                    disabled={!isEditing}
                    className={`w-full px-4 py-2.5 border rounded-lg text-sm appearance-none transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      isEditing 
                        ? 'bg-white border-gray-300 text-gray-900 cursor-pointer hover:border-gray-400' 
                        : 'bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    <option value="GMT+0 (London)">GMT+0 (London)</option>
                    <option value="GMT-5 (New York)">GMT-5 (New York)</option>
                    <option value="GMT+1 (Paris)">GMT+1 (Paris)</option>
                    <option value="GMT+10 (Sydney)">GMT+10 (Sydney)</option>
                  </select>
                  <ChevronDown className={`absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none ${!isEditing ? 'opacity-50' : ''}`} />
                </div>
              </div>
            </div>
          </div>

          {/* Email Address Management */}
          <div className="border-t border-gray-200 pt-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-5">My email Address</h3>
            
            {/* Email Entry */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg mb-4 border border-gray-200">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{editData.email}</p>
                  <p className="text-xs text-gray-500 mt-0.5">1 month ago</p>
                </div>
              </div>
            </div>

            {/* Add Email Button */}
            <button
              onClick={() => {
                // Handle add email action
                console.log('Add email clicked');
              }}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-all shadow-sm hover:shadow-md"
            >
              +Add Email Address
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Profile;
