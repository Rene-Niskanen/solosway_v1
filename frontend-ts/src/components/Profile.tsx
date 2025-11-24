"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { MapPin, Star, MessageCircle, Check, Flag, Clock, User, Home, Building2, DollarSign, FileText, Edit2, Save, X } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { backendApi } from "@/services/backendApi";

interface ProfileProps {
  onNavigate?: (view: string, options?: { showMap?: boolean }) => void;
}

interface RecentWork {
  propertyName: string;
  address: string;
  type: 'primary' | 'secondary';
  date?: string;
}

interface UserData {
  first_name?: string;
  last_name?: string;
  email?: string;
  profile_image?: string;
  avatar_url?: string;
  phone?: string;
  location?: string;
  title?: string;
  propertiesOwned?: number;
  totalPropertyValue?: string;
  propertiesListed?: number;
  lastPropertyAdded?: string;
  skills?: string[];
  recentWork?: RecentWork[];
  rating?: number;
}

const Profile: React.FC<ProfileProps> = ({ onNavigate }) => {
  const [userData, setUserData] = React.useState<UserData | null>(null);
  const [editingField, setEditingField] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState<string>('');
  const [activeTab, setActiveTab] = React.useState<'timeline' | 'about'>('about');
  const [loading, setLoading] = React.useState(true);

  // Fetch user data on mount
  React.useEffect(() => {
    const fetchUserData = async () => {
      try {
        const authResult = await backendApi.checkAuth();
        if (authResult.success && authResult.data?.user) {
          const user = authResult.data.user;
          setUserData({
            ...user,
            title: user.title || 'Property Manager',
            location: user.location || 'New York, NY',
            phone: user.phone || '+1 123 456 7890',
            propertiesOwned: user.propertiesOwned || 12,
            totalPropertyValue: user.totalPropertyValue || '£2,450,000',
            propertiesListed: user.propertiesListed || 8,
            lastPropertyAdded: user.lastPropertyAdded || '15 Mar, 2025',
            skills: user.skills || ['Property Valuation', 'Market Analysis', 'Portfolio Management', 'Real Estate Law', 'Negotiation'],
            recentWork: user.recentWork || [
              { propertyName: 'Riverside Apartments', address: '170 William Street, New York, NY 10038-78', type: 'primary', date: 'Jan 2025' },
              { propertyName: 'Metropolitan Complex', address: '525 E 68th Street, New York, NY 10651-78', type: 'secondary', date: 'Dec 2024' }
            ],
            rating: user.rating || 4.6
          });
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchUserData();
  }, []);

  const getUserName = () => {
    if (userData?.first_name && userData?.last_name) {
      return `${userData.first_name} ${userData.last_name}`;
    }
    if (userData?.email) {
      const emailPrefix = userData.email.split('@')[0];
      return emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
    }
    return 'Admin';
  };

  const getUserEmail = () => {
    return userData?.email || 'admin@solosway.com';
  };

  const getUserInitials = () => {
    const name = getUserName();
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const handleFieldClick = (field: string, currentValue: string) => {
    setEditingField(field);
    // Extract just the number for number fields
    if (field === 'propertiesOwned' || field === 'propertiesListed') {
      const match = currentValue.match(/\d+/);
      setEditValue(match ? match[0] : '');
    } else if (field === 'totalPropertyValue') {
      // Extract the value part after "Total Value: "
      const match = currentValue.match(/Total Value: (.+)/);
      setEditValue(match ? match[1] : currentValue);
    } else if (field === 'lastPropertyAdded') {
      // Extract the date part after "Last Added: "
      const match = currentValue.match(/Last Added: (.+)/);
      setEditValue(match ? match[1] : currentValue);
    } else {
      setEditValue(currentValue);
    }
  };

  const handleFieldSave = (field: string) => {
    if (userData) {
      let newValue: any = editValue;
      
      // Convert to number for numeric fields
      if (field === 'propertiesOwned' || field === 'propertiesListed') {
        newValue = parseInt(editValue) || 0;
      }
      
      setUserData({
        ...userData,
        [field]: newValue
      });
    }
    setEditingField(null);
    setEditValue('');
  };

  const handleFieldCancel = () => {
    setEditingField(null);
    setEditValue('');
  };

  const EditableField: React.FC<{
    field: string;
    value: string;
    icon?: React.ReactNode;
    type?: 'text' | 'number' | 'email' | 'url' | 'tel';
  }> = ({ field, value, icon, type = 'text' }) => {
    const isEditing = editingField === field;
    
    return (
      <div className="flex items-center gap-3 group">
        {icon}
        {isEditing ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              type={type}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="flex-1 px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleFieldSave(field);
                } else if (e.key === 'Escape') {
                  handleFieldCancel();
                }
              }}
            />
            <button
              onClick={() => handleFieldSave(field)}
              className="p-1 text-green-600 hover:text-green-700"
              title="Save"
            >
              <Save className="w-4 h-4" />
            </button>
            <button
              onClick={handleFieldCancel}
              className="p-1 text-red-600 hover:text-red-700"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div
            className="flex items-center gap-2 flex-1 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded -ml-2 group-hover:bg-gray-50"
            onClick={() => handleFieldClick(field, value)}
          >
            <span className="text-sm text-gray-700">{value}</span>
            <Edit2 className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-slate-600 border-r-transparent mb-4"></div>
          <p className="text-lg text-slate-600">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gray-50 flex items-center justify-center py-8 px-4">
      <div className="w-full max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden"
        >
          <div className="flex flex-col lg:flex-row">
            {/* Left Sidebar */}
            <div className="w-full lg:w-80 bg-white border-r border-gray-200 p-6">
              {/* Profile Picture */}
              <div className="mb-8">
                <Avatar className="w-32 h-32 mx-auto mb-4 border-2 border-gray-200">
                  <AvatarImage 
                    src={userData?.profile_image || userData?.avatar_url || "/default profile icon.png"} 
                    alt={getUserName()}
                    className="object-cover"
                  />
                  <AvatarFallback className="bg-slate-100 text-slate-700 text-2xl font-semibold">
                    {getUserInitials()}
                  </AvatarFallback>
                </Avatar>
              </div>

              {/* RECENT WORK Section */}
              <div className="mb-8">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">RECENT WORK</h3>
                <div className="space-y-4">
                  {userData?.recentWork?.map((work, index) => (
                    <div key={index} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{work.propertyName}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          work.type === 'primary' 
                            ? 'bg-blue-100 text-blue-700' 
                            : 'bg-gray-100 text-gray-700'
                        }`}>
                          {work.type === 'primary' ? 'Primary' : 'Secondary'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600">{work.address}</p>
                      {work.date && (
                        <p className="text-xs text-gray-500">{work.date}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* SKILLS Section */}
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">SKILLS</h3>
                <ul className="space-y-2">
                  {userData?.skills?.map((skill, index) => (
                    <li key={index} className="text-sm text-gray-700 flex items-center">
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full mr-2"></span>
                      {skill}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Right Main Content */}
            <div className="flex-1 p-8">
              {/* Header Section */}
              <div className="flex items-start justify-between mb-6">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h1 className="text-3xl font-bold text-gray-900">{getUserName()}</h1>
                    <Check className="w-5 h-5 text-blue-600" />
                  </div>
                  <p className="text-lg text-blue-600 mb-2">{userData?.title || 'Property Manager'}</p>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <MapPin className="w-4 h-4" />
                    <span>{userData?.location || 'New York, NY'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Flag className="w-5 h-5 text-gray-400" />
                  <span className="text-sm text-gray-600">Bookmark</span>
                </div>
              </div>

              {/* Rankings */}
              <div className="mb-6">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-semibold text-gray-900">{userData?.rating?.toFixed(1) || '4.6'}</span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={`w-5 h-5 ${
                          star <= Math.floor(userData?.rating || 4.6)
                            ? 'fill-blue-600 text-blue-600'
                            : 'fill-gray-200 text-gray-200'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 mb-6">
                <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  <MessageCircle className="w-4 h-4" />
                  Send message
                </button>
                <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                  <Check className="w-4 h-4" />
                  Contacts
                </button>
                <button className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                  Report user
                </button>
              </div>

              {/* Navigation Tabs */}
              <div className="flex items-center gap-6 border-b border-gray-200 mb-6">
                <button
                  onClick={() => setActiveTab('timeline')}
                  className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium transition-colors ${
                    activeTab === 'timeline'
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Clock className="w-4 h-4" />
                  Timeline
                </button>
                <button
                  onClick={() => setActiveTab('about')}
                  className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium transition-colors ${
                    activeTab === 'about'
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <User className="w-4 h-4" />
                  About
                </button>
              </div>

              {/* Tab Content */}
              {activeTab === 'about' && (
                <div className="space-y-8">
                  {/* Property Information */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">PROPERTY INFORMATION</h3>
                    <div className="space-y-3">
                      <EditableField
                        field="propertiesOwned"
                        value={`${userData?.propertiesOwned || 12} Properties Owned`}
                        icon={<Home className="w-4 h-4 text-gray-400" />}
                        type="number"
                      />
                      <EditableField
                        field="totalPropertyValue"
                        value={`Total Value: ${userData?.totalPropertyValue || '£2,450,000'}`}
                        icon={<DollarSign className="w-4 h-4 text-gray-400" />}
                        type="text"
                      />
                      <EditableField
                        field="propertiesListed"
                        value={`${userData?.propertiesListed || 8} Properties Listed`}
                        icon={<Building2 className="w-4 h-4 text-gray-400" />}
                        type="number"
                      />
                      <EditableField
                        field="lastPropertyAdded"
                        value={`Last Added: ${userData?.lastPropertyAdded || '15 Mar, 2025'}`}
                        icon={<FileText className="w-4 h-4 text-gray-400" />}
                        type="text"
                      />
                    </div>
                  </div>

                  {/* Contact Information */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">CONTACT INFORMATION</h3>
                    <div className="space-y-3">
                      <EditableField
                        field="phone"
                        value={userData?.phone || '+1 123 456 7890'}
                        icon={<span className="w-4 h-4 text-gray-400">📞</span>}
                        type="tel"
                      />
                      <EditableField
                        field="location"
                        value={userData?.location || 'New York, NY'}
                        icon={<MapPin className="w-4 h-4 text-gray-400" />}
                        type="text"
                      />
                      <EditableField
                        field="email"
                        value={getUserEmail()}
                        icon={<span className="w-4 h-4 text-gray-400">✉️</span>}
                        type="email"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'timeline' && (
                <div className="text-center py-12 text-gray-500">
                  <p>Timeline content coming soon...</p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Profile;
