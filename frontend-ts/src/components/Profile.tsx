"use client";

import * as React from "react";
import { MapPin, User, Home, Building2, FileText, Edit2, Save, X, FolderOpen, Upload, Plus, ChevronLeft, ChevronRight, Mail, Phone } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { backendApi } from "@/services/backendApi";
import { useProjects } from "@/contexts/ProjectsContext";
import { loadRecentProperties, RecentProperty } from "@/utils/recentProjects";
import { EnhancedEditableField } from "./EnhancedEditableField";
import { validateEmail, validatePhone, validateName, validateTitle, validateAddress, validateOrganization } from "@/utils/profileValidation";
import { useProfileUpdate } from "@/hooks/useProfileUpdate";
import { ProfileImageUpload } from "./ProfileImageUpload";
import { CompanyLogoUpload } from "./CompanyLogoUpload";

interface ProfileProps {
  onNavigate?: (view: string, options?: { showMap?: boolean }) => void;
  /** When true, render a compact single-column layout for use inside Settings > General (no contributions/heatmap). */
  embeddedInSettings?: boolean;
}

interface ContributionDay {
  date: string; // YYYY-MM-DD
  count: number;
  activities: ContributionActivity[];
}

interface ContributionActivity {
  type: 'project' | 'document' | 'property' | 'update';
  description: string;
  timestamp: string;
  id?: string;
}

interface UserData {
  first_name?: string;
  last_name?: string;
  email?: string;
  profile_image?: string;
  avatar_url?: string;
  profile_picture_url?: string;
  phone?: string;
  location?: string;
  address?: string;
  title?: string;
  organization?: string;
  company_logo_url?: string;
}

const Profile: React.FC<ProfileProps> = ({ onNavigate, embeddedInSettings }) => {
  const [userData, setUserData] = React.useState<UserData | null>(null);
  const [profilePicCacheBust, setProfilePicCacheBust] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [contributions, setContributions] = React.useState<ContributionDay[]>([]);
  const [activities, setActivities] = React.useState<ContributionActivity[]>([]);
  const [selectedYear, setSelectedYear] = React.useState<number>(new Date().getFullYear());
  const [hoveredDay, setHoveredDay] = React.useState<{ date: string; count: number; x: number; y: number } | null>(null);

  const { projects } = useProjects();
  const currentYear = new Date().getFullYear();
  const { updateProfile, uploadProfilePicture, uploadCompanyLogo, removeProfilePicture, removeCompanyLogo, isUpdating: isProfileUpdating } = useProfileUpdate();
  const [isProfileImageModalOpen, setIsProfileImageModalOpen] = React.useState(false);
  const [isCompanyLogoModalOpen, setIsCompanyLogoModalOpen] = React.useState(false);

  const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

  // Safety check: reset to current year if selectedYear is in the future
  React.useEffect(() => {
    if (selectedYear > currentYear) {
      setSelectedYear(currentYear);
    }
  }, [selectedYear, currentYear]);

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
            address: user.address || user.location || 'New York, NY',
            phone: user.phone || '',
            email: user.email || '',
            organization: user.organization || 'Solosway',
            company_logo_url: user.company_logo_url,
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

  // Aggregate contributions from projects, documents, and properties
  React.useEffect(() => {
    const aggregateContributions = async () => {
      const contributionMap = new Map<string, ContributionActivity[]>();
      const allActivities: ContributionActivity[] = [];

      // Add projects as contributions
      if (projects && projects.length > 0) {
        projects.forEach((project) => {
          const date = new Date(project.created_at).toISOString().split('T')[0];
          const activity: ContributionActivity = {
            type: 'project',
            description: `Created project "${project.title}"`,
            timestamp: project.created_at,
            id: project.id,
          };
          
          if (!contributionMap.has(date)) {
            contributionMap.set(date, []);
          }
          contributionMap.get(date)!.push(activity);
          allActivities.push(activity);
        });
      }

      // Add recent properties as contributions
      try {
        const recentProperties = loadRecentProperties();
        recentProperties.forEach((property: RecentProperty) => {
          if (property.timestamp) {
            const date = new Date(property.timestamp).toISOString().split('T')[0];
            const activity: ContributionActivity = {
              type: 'property',
              description: `Added property "${property.address}"`,
              timestamp: property.timestamp,
              id: property.id,
            };
            
            if (!contributionMap.has(date)) {
              contributionMap.set(date, []);
            }
            contributionMap.get(date)!.push(activity);
            allActivities.push(activity);
          }
        });
      } catch (error) {
        console.error('Error loading recent properties:', error);
      }

      // Convert map to array and sort by date
      const contributionDays: ContributionDay[] = Array.from(contributionMap.entries())
        .map(([date, activities]) => ({
          date,
          count: activities.length,
          activities,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      setContributions(contributionDays);
      
      // Sort activities by timestamp (most recent first)
      allActivities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setActivities(allActivities.slice(0, 50)); // Show last 50 activities
    };

    aggregateContributions();
  }, [projects]);

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

  // Generate heatmap data for the selected year (53 weeks × 7 days = 371 days max)
  const generateHeatmapData = () => {
    const days: { date: string; count: number; activities: ContributionActivity[]; week: number; dayOfWeek: number }[] = [];

    // Get the first day of the year
    const firstDay = new Date(selectedYear, 0, 1);
    // Get the Sunday of the week containing Jan 1 (GitHub starts weeks on Sunday)
    const firstSunday = new Date(firstDay);
    firstSunday.setDate(firstDay.getDate() - firstDay.getDay());

    // Generate exactly 53 weeks × 7 days = 371 days
    const currentDate = new Date(firstSunday);
    const maxDays = 53 * 7; // Exactly 371 days
    
    for (let i = 0; i < maxDays; i++) {
      const week = Math.floor(i / 7);
      const dayOfWeek = i % 7;
      const dateStr = currentDate.toISOString().split('T')[0];
      const contribution = contributions.find(c => c.date === dateStr);
      
      days.push({
        date: dateStr,
        count: contribution?.count || 0,
        activities: contribution?.activities || [],
        week,
        dayOfWeek,
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Ensure we return exactly 371 days
    return days.slice(0, maxDays);
  };

  const getContributionColor = (count: number): string => {
    if (count === 0) return '#ebedf0';
    if (count <= 2) return '#9be9a8';
    if (count <= 5) return '#40c463';
    if (count <= 10) return '#30a14e';
    return '#216e39';
  };

  const formatTimeAgo = (timestamp: string): string => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) {
      const w = Math.floor(diffDays / 7);
      return w === 1 ? '1 week ago' : `${w} weeks ago`;
    }
    if (diffDays < 365) {
      const m = Math.floor(diffDays / 30);
      return m === 1 ? '1 month ago' : `${m} months ago`;
    }
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getActivityIcon = (type: ContributionActivity['type']) => {
    switch (type) {
      case 'project':
        return <FolderOpen className="w-4 h-4" style={{ color: '#d97706' }} />;
      case 'property':
        return <Home className="w-4 h-4" style={{ color: '#16a34a' }} />;
      case 'document':
        return <FileText className="w-4 h-4" style={{ color: '#4f46e5' }} />;
      default:
        return <Plus className="w-4 h-4" style={{ color: '#6b7280' }} />;
    }
  };

  const heatmapData = generateHeatmapData();
  const totalContributions = contributions.reduce((sum, day) => sum + day.count, 0);

  // Calculate available years from contributions
  const availableYears = React.useMemo(() => {
    const years = new Set<number>();
    contributions.forEach((day) => {
      const year = new Date(day.date).getFullYear();
      years.add(year);
    });
    // Always include current year
    years.add(currentYear);
    // Include years from earliest contribution to current year
    const yearArray = Array.from(years).sort((a, b) => a - b);
    return yearArray;
  }, [contributions, currentYear]);

  // Get year buttons to display
  const getYearButtons = () => {
    const minYear = 2020; // Don't go before 2020
    
    if (selectedYear === currentYear) {
      // Show: [currentYear - 2, currentYear - 1, currentYear]
      return [Math.max(minYear, currentYear - 2), currentYear - 1, currentYear].filter(y => y >= minYear && y <= currentYear);
    } else if (selectedYear < currentYear) {
      // Show: [selectedYear - 1, selectedYear, currentYear]
      // Always include current year so user can navigate back
      const years = [
        Math.max(minYear, selectedYear - 1), 
        selectedYear, 
        currentYear
      ];
      // Remove duplicates, filter valid years, and sort
      return [...new Set(years)]
        .filter(y => y >= minYear && y <= currentYear)
        .sort((a, b) => a - b);
    } else {
      // Future year (shouldn't happen, but handle it gracefully)
      // Reset to current year if somehow in the future
      if (selectedYear > currentYear) {
        return [Math.max(minYear, currentYear - 2), currentYear - 1, currentYear].filter(y => y >= minYear && y <= currentYear);
      }
      return [currentYear, currentYear + 1, currentYear + 2].filter(y => y <= currentYear + 10);
    }
  };

  const yearButtons = getYearButtons();

  // Group activities by month
  const groupedActivities = React.useMemo(() => {
    const groups: { [key: string]: ContributionActivity[] } = {};
    activities.forEach((activity) => {
      const date = new Date(activity.timestamp);
      const monthKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      if (!groups[monthKey]) {
        groups[monthKey] = [];
      }
      groups[monthKey].push(activity);
    });
    return groups;
  }, [activities]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#f9fafb' }}>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
        <div className="text-center">
          <div className="inline-block h-8 w-8 border-2 border-solid" style={{ 
            borderColor: '#3b82f6',
            borderRightColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.6s linear infinite'
          }}></div>
          <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '16px', fontWeight: 500 }}>Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={embeddedInSettings ? 'w-full' : 'min-h-screen w-full'}
      style={embeddedInSettings ? { padding: 0 } : { backgroundColor: '#f9fafb', padding: '40px 24px' }}
    >
      <div style={{ maxWidth: embeddedInSettings ? '100%' : '1200px', margin: embeddedInSettings ? 0 : '0 auto', width: '100%' }}>
        <div
          className="transition-all duration-200"
          style={
            embeddedInSettings
              ? { backgroundColor: 'transparent', boxSizing: 'border-box' }
              : {
                  backgroundColor: '#ffffff',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.1)',
                  transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                  boxSizing: 'border-box',
                  borderRadius: '16px',
                  border: '1px solid #e5e7eb',
                  overflow: 'hidden',
                }
          }
        >
          <div className={embeddedInSettings ? 'flex flex-col' : 'flex flex-col lg:flex-row'}>
            {/* Left Sidebar / Profile form */}
            <div
              style={{
                width: '100%',
                maxWidth: embeddedInSettings ? '100%' : '320px',
                backgroundColor: embeddedInSettings ? 'transparent' : '#ffffff',
                borderRight: embeddedInSettings ? 'none' : '1px solid #e5e7eb',
                padding: embeddedInSettings ? '0' : '32px 28px',
              }}
            >
              {/* Profile Picture */}
              <div style={{ marginBottom: space.xxl, textAlign: 'center' }}>
                <div 
                  style={{ position: 'relative', display: 'inline-block', marginBottom: space.xl }}
                  className="group"
                >
                  <div 
                    className="transition-all duration-200"
                    style={{
                      transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                      boxSizing: 'border-box',
                      display: 'inline-block',
                      borderRadius: '50%',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                      padding: '3px',
                      backgroundColor: '#ffffff',
                      border: '1px solid #e5e7eb',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.12)';
                      e.currentTarget.style.borderColor = '#3b82f6';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.08)';
                      e.currentTarget.style.borderColor = '#e5e7eb';
                    }}
                  >
                    <Avatar style={{ width: '96px', height: '96px', margin: '0 auto', borderRadius: '50%', cursor: 'pointer' }}>
                      <AvatarImage 
                        src={(() => {
                          const base = userData?.profile_image || userData?.avatar_url || userData?.profile_picture_url || "/default profile icon.png";
                          return base.startsWith('http') && profilePicCacheBust ? `${base}?t=${profilePicCacheBust}` : base;
                        })()} 
                        alt={getUserName()}
                        style={{ objectFit: 'cover', borderRadius: '50%' }}
                      />
                      <AvatarFallback style={{ backgroundColor: '#f3f4f6', color: '#6b7280', fontSize: '28px', fontWeight: 600, borderRadius: '50%' }}>
                        {getUserInitials()}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  {/* Hover overlay */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '3px',
                      left: '3px',
                      right: '3px',
                      bottom: '3px',
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0,
                      transition: 'opacity 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0';
                    }}
                    onClick={() => setIsProfileImageModalOpen(true)}
                  >
                    <span style={{ color: '#ffffff', fontSize: '12px', fontWeight: 500 }}>Edit</span>
                  </div>
                </div>
                
                {/* Name - Editable */}
                <div style={{ marginBottom: space.sm }}>
                  <EnhancedEditableField
                    value={
                      userData?.first_name || userData?.last_name
                        ? `${userData.first_name || ''} ${userData.last_name || ''}`.trim()
                        : ''
                    }
                    onSave={async (value) => {
                      try {
                        const parts = value.trim().split(/\s+/);
                        const firstName = parts[0] || '';
                        const lastName = parts.slice(1).join(' ') || '';
                        if (!firstName) {
                          throw new Error('First name is required');
                        }
                        await updateProfile({ first_name: firstName, last_name: lastName });
                        setUserData(prev => prev ? { ...prev, first_name: firstName, last_name: lastName } : null);
                      } catch (error) {
                        console.error('Failed to save name:', error);
                        throw error;
                      }
                    }}
                    validate={(value) => {
                      const trimmed = value.trim();
                      if (!trimmed) {
                        return { isValid: false, error: 'Name is required' };
                      }
                      const parts = trimmed.split(/\s+/);
                      if (parts.length < 1 || !parts[0]) {
                        return { isValid: false, error: 'Please enter at least a first name' };
                      }
                      const firstNameResult = validateName(parts[0], 'First name');
                      if (!firstNameResult.isValid) {
                        return firstNameResult;
                      }
                      if (parts.length > 1 && parts[1]) {
                        const lastNameResult = validateName(parts.slice(1).join(' '), 'Last name');
                        if (!lastNameResult.isValid) {
                          return lastNameResult;
                        }
                      }
                      return { isValid: true };
                    }}
                    placeholder="Enter your name"
                    icon={<User className="w-4 h-4" />}
                    required
                  />
                </div>

                {/* Title - Editable */}
                <div style={{ marginBottom: space.sm }}>
                  <EnhancedEditableField
                    value={userData?.title || 'Property Manager'}
                    onSave={async (value) => {
                      try {
                        await updateProfile({ title: value });
                        setUserData(prev => prev ? { ...prev, title: value } : null);
                      } catch (error) {
                        console.error('Failed to save title:', error);
                        throw error;
                      }
                    }}
                    validate={validateTitle}
                    placeholder="Enter your title"
                    required
                  />
                </div>
              </div>

              {/* Divider - full width via negative margins matching sidebar padding */}
              <div style={{ height: 1, backgroundColor: '#e5e7eb', marginTop: 0, marginRight: -28, marginBottom: space.xl, marginLeft: -28 }} />

              {/* Contact Information */}
              <div style={{ marginBottom: space.xl }}>
                {/* Address - Editable */}
                <div style={{ marginBottom: space.md }}>
                  <EnhancedEditableField
                    value={userData?.address || userData?.location || ''}
                    onSave={async (value) => {
                      try {
                        await updateProfile({ address: value || null, location: value || null });
                        setUserData(prev => prev ? { ...prev, address: value || undefined, location: value || undefined } : null);
                      } catch (error) {
                        console.error('Failed to save address:', error);
                        throw error;
                      }
                    }}
                    validate={validateAddress}
                    placeholder="Enter your address"
                    icon={<MapPin className="w-4 h-4" />}
                    multiline
                  />
                </div>

                {/* Email - Editable */}
                <div style={{ marginBottom: space.md }}>
                  <EnhancedEditableField
                    value={userData?.email || ''}
                    onSave={async (value) => {
                      try {
                        await updateProfile({ email: value });
                        setUserData(prev => prev ? { ...prev, email: value } : null);
                      } catch (error) {
                        console.error('Failed to save email:', error);
                        throw error;
                      }
                    }}
                    validate={validateEmail}
                    type="email"
                    placeholder="Enter your email"
                    icon={<Mail className="w-4 h-4" />}
                    required
                  />
                </div>

                {/* Phone - Editable */}
                <div>
                  <EnhancedEditableField
                    value={userData?.phone || ''}
                    onSave={async (value) => {
                      try {
                        await updateProfile({ phone: value || null });
                        setUserData(prev => prev ? { ...prev, phone: value || undefined } : null);
                      } catch (error) {
                        console.error('Failed to save phone:', error);
                        throw error;
                      }
                    }}
                    validate={validatePhone}
                    type="tel"
                    placeholder="Enter your phone number"
                    icon={<Phone className="w-4 h-4" />}
                  />
                </div>
              </div>

              {/* Divider - full width via negative margins matching sidebar padding */}
              <div style={{ height: 1, backgroundColor: '#e5e7eb', marginTop: 0, marginRight: -28, marginBottom: space.xl, marginLeft: -28 }} />

              {/* Organization */}
              <div style={{ marginBottom: space.sm }}>
                <div style={{ 
                  fontSize: '11px', 
                  color: '#9ca3af', 
                  marginBottom: space.md, 
                  fontWeight: 600, 
                  letterSpacing: '0.05em', 
                  textTransform: 'uppercase',
                }}>
                  Organization
                </div>
                <EnhancedEditableField
                  value={userData?.organization || 'Solosway'}
                  onSave={async (value) => {
                    await updateProfile({ organization: value });
                    setUserData(prev => prev ? { ...prev, organization: value } : null);
                  }}
                  validate={validateOrganization}
                  placeholder="Enter organization name"
                  icon={<Building2 className="w-4 h-4" />}
                  required
                />
                
                {/* Logo section */}
                <div style={{ marginTop: space.lg }}>
                  {userData?.company_logo_url ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div
                        style={{
                          width: '48px',
                          height: '48px',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          border: '1px solid #e5e7eb',
                          backgroundColor: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <img
                          src={userData.company_logo_url}
                          alt="Company logo"
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => setIsCompanyLogoModalOpen(true)}
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            fontWeight: 500,
                            color: '#3b82f6',
                            backgroundColor: '#eff6ff',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#dbeafe';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = '#eff6ff';
                          }}
                        >
                          Change
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm('Remove company logo?')) {
                              removeCompanyLogo().then(() => {
                                setUserData(prev => prev ? { ...prev, company_logo_url: undefined } : null);
                              }).catch(console.error);
                            }
                          }}
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            fontWeight: 500,
                            color: '#ef4444',
                            backgroundColor: '#fef2f2',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#fee2e2';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = '#fef2f2';
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setIsCompanyLogoModalOpen(true)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 16px',
                        fontSize: '13px',
                        fontWeight: 500,
                        color: '#6b7280',
                        backgroundColor: '#f9fafb',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                        width: '100%',
                        justifyContent: 'center',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f3f4f6';
                        e.currentTarget.style.borderColor = '#d1d5db';
                        e.currentTarget.style.color = '#374151';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#f9fafb';
                        e.currentTarget.style.borderColor = '#e5e7eb';
                        e.currentTarget.style.color = '#6b7280';
                      }}
                    >
                      <Upload className="w-4 h-4" />
                      <span>Upload company logo</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Right Main Content — hidden when embedded in Settings */}
            {!embeddedInSettings && (
            <div style={{ flex: 1, padding: space.xxl }}>
              {/* Contributions Heatmap Section */}
              <div style={{ marginBottom: space.xxl }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.lg }}>
                  <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#1a1a1a', lineHeight: 1.25, margin: 0 }}>
                    {totalContributions} contribution{totalContributions !== 1 ? 's' : ''} in {selectedYear}
                  </h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {/* Left arrow - navigate to previous year */}
                    <button
                      onClick={() => {
                        const prevYear = selectedYear - 1;
                        if (prevYear >= 2020) {
                          setSelectedYear(prevYear);
                        }
                      }}
                      disabled={selectedYear <= 2020}
                      style={{
                        padding: '6px',
                        color: selectedYear <= 2020 ? '#d1d5db' : '#6b7280',
                        backgroundColor: 'transparent',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        cursor: selectedYear <= 2020 ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 150ms ease',
                      }}
                      onMouseEnter={(e) => {
                        if (selectedYear > 2020) {
                          e.currentTarget.style.backgroundColor = '#f3f4f6';
                          e.currentTarget.style.borderColor = '#d1d5db';
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.borderColor = '#e5e7eb';
                      }}
                      title="Previous year"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    {/* Year buttons */}
                    {yearButtons.map((year) => {
                      const isSelected = year === selectedYear;
                      return (
                        <button
                          key={year}
                          onClick={() => setSelectedYear(year)}
                          style={{
                            padding: '6px 14px',
                            fontSize: '12px',
                            fontWeight: 500,
                            color: isSelected ? '#ffffff' : '#6b7280',
                            backgroundColor: isSelected ? '#3b82f6' : 'transparent',
                            border: `1px solid ${isSelected ? '#3b82f6' : '#e5e7eb'}`,
                            borderRadius: '9999px',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.backgroundColor = '#f3f4f6';
                              e.currentTarget.style.borderColor = '#d1d5db';
                              e.currentTarget.style.color = '#374151';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.backgroundColor = 'transparent';
                              e.currentTarget.style.borderColor = '#e5e7eb';
                              e.currentTarget.style.color = '#6b7280';
                            }
                          }}
                        >
                          {year}
                        </button>
                      );
                    })}

                    {/* Right arrow - navigate to next year */}
                    <button
                      onClick={() => {
                        const nextYear = selectedYear + 1;
                        if (nextYear <= currentYear) {
                          setSelectedYear(nextYear);
                        }
                      }}
                      disabled={selectedYear >= currentYear}
                      style={{
                        padding: '6px',
                        color: selectedYear >= currentYear ? '#d1d5db' : '#6b7280',
                        backgroundColor: 'transparent',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        cursor: selectedYear >= currentYear ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 150ms ease',
                      }}
                      onMouseEnter={(e) => {
                        if (selectedYear < currentYear) {
                          e.currentTarget.style.backgroundColor = '#f3f4f6';
                          e.currentTarget.style.borderColor = '#d1d5db';
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.borderColor = '#e5e7eb';
                      }}
                      title="Next year"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Heatmap Grid */}
                <div style={{ 
                  backgroundColor: '#ffffff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  padding: '20px',
                  marginBottom: space.lg,
                  overflow: 'hidden',
                }}>
                  <div style={{ 
                    display: 'flex', 
                    gap: '4px', 
                    marginBottom: space.sm,
                    overflow: 'hidden',
                  }}>
                    {/* Day labels */}
                    <div style={{ 
                      width: '24px', 
                      fontSize: '10px', 
                      color: '#9ca3af', 
                      paddingTop: '14px',
                      flexShrink: 0,
                      fontWeight: 500,
                    }}>
                      <div style={{ height: '11px', lineHeight: '11px' }}>S</div>
                      <div style={{ height: '11px', lineHeight: '11px' }}>M</div>
                      <div style={{ height: '11px', lineHeight: '11px' }}>T</div>
                      <div style={{ height: '11px', lineHeight: '11px' }}>W</div>
                      <div style={{ height: '11px', lineHeight: '11px' }}>T</div>
                      <div style={{ height: '11px', lineHeight: '11px' }}>F</div>
                      <div style={{ height: '11px', lineHeight: '11px' }}>S</div>
                    </div>

                    {/* Grid container */}
                    <div style={{ 
                      flex: 1, 
                      position: 'relative',
                      overflow: 'hidden',
                      minWidth: 0,
                      maxWidth: '100%',
                    }}>
                      {/* Month labels - calculate positions based on weeks */}
                      <div style={{ 
                        display: 'flex', 
                        marginBottom: '6px', 
                        fontSize: '10px', 
                        color: '#9ca3af', 
                        position: 'relative', 
                        height: '14px',
                        overflow: 'hidden',
                        fontWeight: 500,
                      }}>
                        {(() => {
                          const monthLabels: { month: string; week: number }[] = [];
                          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                          let lastMonth = -1;
                          
                          heatmapData.forEach((day, idx) => {
                            const date = new Date(day.date);
                            const month = date.getMonth();
                            const week = Math.floor(idx / 7);
                            
                            if (month !== lastMonth && date.getDate() <= 7) {
                              monthLabels.push({ month: months[month], week });
                              lastMonth = month;
                            }
                          });
                          
                          return monthLabels.map(({ month, week }) => (
                            <div
                              key={`${month}-${week}`}
                              style={{
                                position: 'absolute',
                                left: week === 0 ? '0' : `${(week / 53) * 100}%`,
                                transform: week === 0 ? 'none' : 'translateX(-50%)',
                              }}
                            >
                              {month}
                            </div>
                          ));
                        })()}
                      </div>

                      {/* Heatmap squares - organized by weeks (columns) */}
                      <div style={{ 
                        display: 'flex', 
                        gap: '3px',
                        flexWrap: 'nowrap',
                        overflow: 'hidden',
                        width: '100%',
                        maxWidth: '100%',
                        position: 'relative',
                        height: '77px',
                      }}>
                        {Array.from({ length: Math.min(53, Math.ceil(heatmapData.length / 7)) }, (_, weekIdx) => {
                          const weekStartIdx = weekIdx * 7;
                          if (weekStartIdx >= heatmapData.length) return null;
                          
                          return (
                            <div 
                              key={weekIdx} 
                              style={{ 
                                display: 'flex', 
                                flexDirection: 'column', 
                                gap: '3px',
                                flexShrink: 0,
                                width: '11px',
                                height: '77px',
                                overflow: 'hidden',
                              }}
                            >
                              {Array.from({ length: 7 }, (_, dayIdx) => {
                                const dayIdxInData = weekStartIdx + dayIdx;
                                const day = heatmapData[dayIdxInData];
                                if (!day) {
                                  return (
                                    <div
                                      key={`empty-${weekIdx}-${dayIdx}`}
                                      style={{
                                        width: '11px',
                                        height: '11px',
                                        backgroundColor: '#ebedf0',
                                        borderRadius: '2px',
                                        flexShrink: 0,
                                      }}
                                    />
                                  );
                                }
                                
                                const date = new Date(day.date);
                                const isCurrentYear = date.getFullYear() === selectedYear;
                                
                                return (
                                  <div
                                    key={`${day.date}-${weekIdx}-${dayIdx}`}
                                    style={{
                                      width: '11px',
                                      height: '11px',
                                      backgroundColor: isCurrentYear ? getContributionColor(day.count) : '#ebedf0',
                                      borderRadius: '2px',
                                      cursor: isCurrentYear ? 'pointer' : 'default',
                                      position: 'relative',
                                      flexShrink: 0,
                                      transition: 'transform 100ms ease',
                                    }}
                                    onMouseEnter={(e) => {
                                      if (isCurrentYear) {
                                        e.currentTarget.style.transform = 'scale(1.2)';
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setHoveredDay({
                                          date: day.date,
                                          count: day.count,
                                          x: rect.left + rect.width / 2,
                                          y: rect.top,
                                        });
                                      }
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.transform = 'scale(1)';
                                      setHoveredDay(null);
                                    }}
                                  />
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Legend - text aligned to 11px square height */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: space.sm, marginTop: space.lg, fontSize: '11px', color: '#9ca3af', fontWeight: 500 }}>
                    <span style={{ lineHeight: '11px' }}>Less</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <div style={{ width: 11, height: 11, backgroundColor: '#ebedf0', borderRadius: '2px' }}></div>
                      <div style={{ width: 11, height: 11, backgroundColor: '#9BE9A8', borderRadius: '2px' }}></div>
                      <div style={{ width: 11, height: 11, backgroundColor: '#40C463', borderRadius: '2px' }}></div>
                      <div style={{ width: 11, height: 11, backgroundColor: '#30A14E', borderRadius: '2px' }}></div>
                      <div style={{ width: 11, height: 11, backgroundColor: '#216E39', borderRadius: '2px' }}></div>
                    </div>
                    <span style={{ lineHeight: '11px' }}>More</span>
                  </div>
                </div>

                {/* Tooltip */}
                {hoveredDay && (
                  <div
                    style={{
                      position: 'fixed',
                      left: `${hoveredDay.x}px`,
                      top: `${hoveredDay.y - 44}px`,
                      backgroundColor: '#1f2937',
                      color: '#ffffff',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 500,
                      zIndex: 1000,
                      pointerEvents: 'none',
                      transform: 'translateX(-50%)',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                    }}
                  >
                    {hoveredDay.count} contribution{hoveredDay.count !== 1 ? 's' : ''} on {new Date(hoveredDay.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                )}
              </div>

              {/* Popular Projects Section */}
              {projects && projects.length > 0 && (
                <div style={{ marginBottom: space.xxl }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.lg }}>
                    <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#1a1a1a' }}>
                      Popular projects
                    </h2>
                  </div>
                  <div style={{ 
                    backgroundColor: '#ffffff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '12px',
                    overflow: 'hidden',
                  }}>
                    {projects.slice(0, 6).map((project, idx) => (
                      <div
                        key={project.id}
                        style={{
                          padding: '14px 18px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          borderBottom: idx < Math.min(projects.length, 6) - 1 ? '1px solid #f3f4f6' : 'none',
                          transition: 'background-color 150ms ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#f9fafb';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                          <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '8px',
                            backgroundColor: '#eff6ff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}>
                            <FolderOpen className="w-4 h-4" style={{ color: '#3b82f6' }} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ fontSize: '13px', fontWeight: 500, color: '#1a1a1a' }}>
                                {project.title}
                              </span>
                              <span style={{
                                fontSize: '11px',
                                padding: '2px 8px',
                                backgroundColor: '#f3f4f6',
                                color: '#6b7280',
                                borderRadius: '9999px',
                                fontWeight: 500,
                              }}>
                                {project.status}
                              </span>
                            </div>
                            {project.client_name && (
                              <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
                                {project.client_name}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Contribution Activity List */}
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#1a1a1a', marginBottom: space.lg }}>
                  Contribution activity
                </h2>
                
                {Object.keys(groupedActivities).length === 0 ? (
                  <div style={{ 
                    backgroundColor: '#ffffff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '12px',
                    padding: '40px 24px',
                    textAlign: 'center',
                  }}>
                    <div style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '12px',
                      backgroundColor: '#f3f4f6',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 16px',
                    }}>
                      <FileText className="w-5 h-5" style={{ color: '#9ca3af' }} />
                    </div>
                    <p style={{ fontSize: '14px', color: '#6b7280', fontWeight: 500 }}>No contributions yet</p>
                    <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>Your activity will appear here</p>
                  </div>
                ) : (
                  Object.entries(groupedActivities).map(([month, monthActivities]) => (
                    <div key={month} style={{ marginBottom: space.xl }}>
                      <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#6b7280', marginBottom: space.md }}>
                        {month}
                      </h3>
                      <div style={{ 
                        backgroundColor: '#ffffff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '12px',
                        overflow: 'hidden',
                      }}>
                        {monthActivities.map((activity, idx) => (
                          <div
                            key={`${activity.timestamp}-${activity.type}-${idx}-${activity.id || ''}`}
                            style={{
                              padding: space.lg,
                              borderBottom: idx < monthActivities.length - 1 ? '1px solid #f3f4f6' : 'none',
                              display: 'flex',
                              alignItems: 'center',
                              gap: space.lg,
                              cursor: 'pointer',
                              transition: 'background-color 150ms ease',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#f9fafb';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                          >
                            <div style={{
                              width: 32,
                              height: 32,
                              borderRadius: '8px',
                              backgroundColor: activity.type === 'project' ? '#fef3c7' : activity.type === 'property' ? '#dcfce7' : '#e0e7ff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}>
                              {activity.type === 'project' && <FolderOpen className="w-4 h-4" style={{ color: '#d97706' }} />}
                              {activity.type === 'property' && <Home className="w-4 h-4" style={{ color: '#16a34a' }} />}
                              {activity.type === 'document' && <FileText className="w-4 h-4" style={{ color: '#4f46e5' }} />}
                              {activity.type !== 'project' && activity.type !== 'property' && activity.type !== 'document' && <Plus className="w-4 h-4" style={{ color: '#6b7280' }} />}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontSize: '13px', color: '#374151', fontWeight: 450, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {activity.description}
                              </p>
                            </div>
                            <div style={{ 
                              fontSize: '12px', 
                              color: '#9ca3af',
                              fontWeight: 500,
                              flexShrink: 0,
                            }}>
                              {formatTimeAgo(activity.timestamp)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            )}
          </div>
        </div>
      </div>

      {/* Profile Image Upload Modal */}
      <ProfileImageUpload
        isOpen={isProfileImageModalOpen}
        onClose={() => setIsProfileImageModalOpen(false)}
        onSave={async (file) => {
          const imageUrl = await uploadProfilePicture(file);
          const cacheBust = Date.now();
          setUserData(prev => prev ? { ...prev, profile_image: imageUrl, avatar_url: imageUrl } : null);
          setProfilePicCacheBust(cacheBust);
          window.dispatchEvent(new CustomEvent('profilePictureUpdated', { detail: { profileImageUrl: imageUrl, avatarUrl: imageUrl, removed: false, cacheBust } }));
        }}
        onRemove={async () => {
          await removeProfilePicture();
          const cacheBust = Date.now();
          setUserData(prev => prev ? { ...prev, profile_image: undefined, avatar_url: undefined } : null);
          setProfilePicCacheBust(cacheBust);
          window.dispatchEvent(new CustomEvent('profilePictureUpdated', { detail: { removed: true, cacheBust } }));
        }}
        currentImageUrl={userData?.profile_image || userData?.avatar_url || userData?.profile_picture_url}
      />

      {/* Company Logo Upload Modal */}
      <CompanyLogoUpload
        isOpen={isCompanyLogoModalOpen}
        onClose={() => setIsCompanyLogoModalOpen(false)}
        onSave={async (file) => {
          const logoUrl = await uploadCompanyLogo(file);
          setUserData(prev => prev ? { ...prev, company_logo_url: logoUrl } : null);
        }}
        onRemove={async () => {
          await removeCompanyLogo();
          setUserData(prev => prev ? { ...prev, company_logo_url: undefined } : null);
        }}
        currentLogoUrl={userData?.company_logo_url}
      />
    </div>
  );
};

export default Profile;
