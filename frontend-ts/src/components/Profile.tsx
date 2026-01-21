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
  phone?: string;
  location?: string;
  address?: string;
  title?: string;
  organization?: string;
  company_logo_url?: string;
}

const Profile: React.FC<ProfileProps> = ({ onNavigate }) => {
  const [userData, setUserData] = React.useState<UserData | null>(null);
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
    if (count === 0) return '#EBEDF0';
    if (count <= 2) return '#9BE9A8';
    if (count <= 5) return '#40C463';
    if (count <= 10) return '#30A14E';
    return '#216E39';
  };

  const formatTimeAgo = (timestamp: string): string => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getActivityIcon = (type: ContributionActivity['type']) => {
    switch (type) {
      case 'project':
        return <FolderOpen className="w-3.5 h-3.5" style={{ color: '#6C7180' }} />;
      case 'property':
        return <Home className="w-3.5 h-3.5" style={{ color: '#6C7180' }} />;
      case 'document':
        return <FileText className="w-3.5 h-3.5" style={{ color: '#6C7180' }} />;
      default:
        return <Plus className="w-3.5 h-3.5" style={{ color: '#6C7180' }} />;
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
      <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#F9F9F9' }}>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
        <div className="text-center">
          <div className="inline-block h-8 w-8 border-2 border-solid" style={{ 
            borderColor: '#63748A',
            borderRightColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.5s linear infinite'
          }}></div>
          <p style={{ fontSize: '12px', color: '#63748A', marginTop: '12px' }}>Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: '#F8F9FA', padding: '32px 16px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        <div 
          className="rounded-xl transition-all duration-200"
          style={{ 
            backgroundColor: '#FFFFFF',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
            transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
            boxSizing: 'border-box',
            borderRadius: '12px',
            border: 'none',
          }}
        >
          <div className="flex flex-col lg:flex-row">
            {/* Left Sidebar */}
            <div style={{ 
              width: '100%',
              maxWidth: '300px',
              backgroundColor: '#F8F9FA',
              borderRight: '1px solid #DADCE0',
              padding: '32px 24px',
              borderRadius: '12px 0 0 12px',
            }}>
              {/* Profile Picture */}
              <div style={{ marginBottom: '24px', textAlign: 'center' }}>
                <div 
                  style={{ position: 'relative', display: 'inline-block', marginBottom: '16px' }}
                  className="group"
                >
                  <div 
                    className="border border-transparent hover:border-gray-200 rounded-full transition-all duration-200"
                    style={{
                      transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                      boxSizing: 'border-box',
                      display: 'inline-block',
                      borderRadius: '50%',
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
                      padding: '4px',
                      backgroundColor: '#FFFFFF',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.12)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.08)';
                    }}
                  >
                    <Avatar style={{ width: '120px', height: '120px', margin: '0 auto', borderRadius: '50%', cursor: 'pointer', border: '4px solid #FFFFFF' }}>
                      <AvatarImage 
                        src={userData?.profile_image || userData?.avatar_url || "/default profile icon.png"} 
                        alt={getUserName()}
                        style={{ objectFit: 'cover', borderRadius: '50%' }}
                      />
                      <AvatarFallback style={{ backgroundColor: '#DADCE0', color: '#5F6368', fontSize: '36px', fontWeight: 500, borderRadius: '50%' }}>
                        {getUserInitials()}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  {/* Hover overlay */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '4px',
                      left: '4px',
                      right: '4px',
                      bottom: '4px',
                      backgroundColor: 'rgba(0, 0, 0, 0.6)',
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
                    <span style={{ color: '#FFFFFF', fontSize: '13px', fontWeight: 500, letterSpacing: '0.5px' }}>Change photo</span>
                  </div>
                </div>
                
                {/* Name - Editable */}
                <div style={{ marginBottom: '16px' }}>
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
                    icon={<User className="w-4.5 h-4.5" />}
                    required
                  />
                </div>

                {/* Title - Editable */}
                <div style={{ marginBottom: '16px' }}>
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

                {/* Address - Editable */}
                <div style={{ marginBottom: '16px' }}>
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
                    icon={<MapPin className="w-4.5 h-4.5" />}
                    multiline
                  />
                </div>

                {/* Email - Editable */}
                <div style={{ marginBottom: '16px' }}>
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
                    icon={<Mail className="w-4.5 h-4.5" />}
                    required
                  />
                </div>

                {/* Phone - Editable */}
                <div style={{ marginBottom: '16px' }}>
                  <EnhancedEditableField
                    value={userData?.phone || ''}
                    onSave={async (value) => {
                      try {
                        await updateProfile({ phone: value || null });
                        setUserData(prev => prev ? { ...prev, phone: value || undefined } : null);
                      } catch (error) {
                        console.error('Failed to save phone:', error);
                        throw error; // Re-throw to let EnhancedEditableField handle the error display
                      }
                    }}
                    validate={validatePhone}
                    type="tel"
                    placeholder="Enter your phone number"
                    icon={<Phone className="w-4.5 h-4.5" />}
                  />
                </div>
              </div>

              {/* Organization */}
              <div style={{ 
                padding: '20px',
                backgroundColor: '#FFFFFF',
                border: '1px solid #DADCE0',
                borderRadius: '12px',
                marginBottom: '24px',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
              }}>
                <div style={{ fontSize: '11px', color: '#5F6368', marginBottom: '16px', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase', lineHeight: '1.4' }}>Organization</div>
                <EnhancedEditableField
                  value={userData?.organization || 'Solosway'}
                  onSave={async (value) => {
                    await updateProfile({ organization: value });
                    setUserData(prev => prev ? { ...prev, organization: value } : null);
                  }}
                  validate={validateOrganization}
                  placeholder="Enter organization name"
                  icon={<Building2 className="w-4.5 h-4.5" />}
                  required
                />
                {/* Logo upload area */}
                <div
                  style={{
                    width: '64px',
                    height: '64px',
                    border: '2px dashed #DADCE0',
                    backgroundColor: userData?.company_logo_url ? 'transparent' : '#F8F9FA',
                    borderRadius: '8px',
                    marginTop: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    position: 'relative',
                    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#1A73E8';
                    e.currentTarget.style.backgroundColor = '#F1F3F4';
                    e.currentTarget.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#DADCE0';
                    e.currentTarget.style.backgroundColor = userData?.company_logo_url ? 'transparent' : '#F8F9FA';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  onClick={() => setIsCompanyLogoModalOpen(true)}
                >
                  {userData?.company_logo_url ? (
                    <>
                      <img
                        src={userData.company_logo_url}
                        alt="Company logo"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                          borderRadius: '6px',
                        }}
                      />
                      {/* Remove button overlay - appears on hover */}
                      <div
                        style={{
                          position: 'absolute',
                          top: '-8px',
                          right: '-8px',
                          width: '20px',
                          height: '20px',
                          backgroundColor: '#EA4335',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          opacity: 0,
                          transition: 'opacity 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                          boxShadow: '0 2px 4px rgba(234, 67, 53, 0.3)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.opacity = '1';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.opacity = '0';
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm('Remove company logo?')) {
                            removeCompanyLogo().then(() => {
                              setUserData(prev => prev ? { ...prev, company_logo_url: undefined } : null);
                            }).catch(console.error);
                          }
                        }}
                        title="Remove logo"
                      >
                        <X className="w-3 h-3" style={{ color: '#FFFFFF' }} />
                      </div>
                    </>
                  ) : (
                    <Upload className="w-5 h-5" style={{ color: '#5F6368' }} />
                  )}
                </div>
              </div>
            </div>

            {/* Right Main Content */}
            <div style={{ flex: 1, padding: '24px' }}>
              {/* Contributions Heatmap Section */}
              <div style={{ marginBottom: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h2 style={{ fontSize: '14px', fontWeight: 600, color: '#415C85' }}>
                    {totalContributions} contributions in {selectedYear}
                  </h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
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
                        padding: '4px 6px',
                        fontSize: '11px',
                        color: selectedYear <= 2020 ? '#9CA3AF' : '#63748A',
                        backgroundColor: 'transparent',
                        border: '1px solid #E9E9EB',
                        borderRadius: '2px',
                        cursor: selectedYear <= 2020 ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        opacity: selectedYear <= 2020 ? 0.5 : 1,
                      }}
                      title="Previous year"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>

                    {/* Year buttons */}
                    {yearButtons.map((year) => {
                      const isCurrentYear = year === currentYear;
                      const isSelected = year === selectedYear;
                      return (
                        <button
                          key={year}
                          onClick={() => setSelectedYear(year)}
                          style={{
                            padding: '4px 8px',
                            fontSize: '11px',
                            fontWeight: 500,
                            color: isSelected ? '#FFFFFF' : (isCurrentYear ? '#F59E0B' : '#63748A'),
                            backgroundColor: isSelected 
                              ? (isCurrentYear ? '#F59E0B' : '#415C85')
                              : 'transparent',
                            border: `1px solid ${isSelected || isCurrentYear ? (isCurrentYear ? '#F59E0B' : '#415C85') : '#E9E9EB'}`,
                            borderRadius: '2px',
                            cursor: 'pointer',
                          }}
                          title={isCurrentYear ? 'Current year' : undefined}
                        >
                          {year}
                        </button>
                      );
                    })}

                    {/* Current year button - always visible */}
                    {!yearButtons.includes(currentYear) && (
                      <button
                        onClick={() => setSelectedYear(currentYear)}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          fontWeight: 500,
                          color: selectedYear === currentYear ? '#FFFFFF' : '#F59E0B',
                          backgroundColor: selectedYear === currentYear ? '#F59E0B' : 'transparent',
                          border: `1px solid ${selectedYear === currentYear ? '#F59E0B' : '#E9E9EB'}`,
                          borderRadius: '2px',
                          cursor: 'pointer',
                        }}
                        title="Jump to current year"
                      >
                        Current
                      </button>
                    )}

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
                        padding: '4px 6px',
                        fontSize: '11px',
                        color: selectedYear >= currentYear ? '#9CA3AF' : '#63748A',
                        backgroundColor: 'transparent',
                        border: '1px solid #E9E9EB',
                        borderRadius: '2px',
                        cursor: selectedYear >= currentYear ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        opacity: selectedYear >= currentYear ? 0.5 : 1,
                      }}
                      title="Next year"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Heatmap Grid */}
                <div style={{ 
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #E9E9EB',
                  borderRadius: 0,
                  padding: '16px',
                  marginBottom: '12px',
                  overflow: 'hidden', // Prevent any content from leaking outside
                }}>
                  <div style={{ 
                    display: 'flex', 
                    gap: '4px', 
                    marginBottom: '8px',
                    overflow: 'hidden', // Prevent overflow
                  }}>
                    {/* Day labels */}
                    <div style={{ 
                      width: '20px', 
                      fontSize: '10px', 
                      color: '#6C7180', 
                      paddingTop: '12px',
                      flexShrink: 0, // Prevent shrinking
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
                      minWidth: 0, // Prevent flex item from overflowing
                      maxWidth: '100%', // Ensure it doesn't exceed container
                    }}>
                      {/* Month labels - calculate positions based on weeks */}
                      <div style={{ 
                        display: 'flex', 
                        marginBottom: '4px', 
                        fontSize: '10px', 
                        color: '#6C7180', 
                        position: 'relative', 
                        height: '12px',
                        overflow: 'hidden',
                      }}>
                        {(() => {
                          const monthLabels: { month: string; week: number }[] = [];
                          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                          let lastMonth = -1;
                          
                          heatmapData.forEach((day, idx) => {
                            const date = new Date(day.date);
                            const month = date.getMonth();
                            const week = Math.floor(idx / 7);
                            
                            // Only show label at the start of each month
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
                                left: `${(week / 53) * 100}%`,
                                transform: 'translateX(-50%)',
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
                        height: '77px', // Fixed height: 7 rows × 11px = 77px
                      }}>
                        {Array.from({ length: Math.min(53, Math.ceil(heatmapData.length / 7)) }, (_, weekIdx) => {
                          // Only render if we have data for this week
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
                                width: '11px', // Fixed width per week column
                                height: '77px', // Fixed height to match container
                                overflow: 'hidden', // Prevent any overflow
                              }}
                            >
                              {Array.from({ length: 7 }, (_, dayIdx) => {
                                const dayIdxInData = weekStartIdx + dayIdx;
                                const day = heatmapData[dayIdxInData];
                                if (!day) {
                                  // Render empty square if no data (shouldn't happen, but be safe)
                                  return (
                                    <div
                                      key={`empty-${weekIdx}-${dayIdx}`}
                                      style={{
                                        width: '11px',
                                        height: '11px',
                                        backgroundColor: '#EBEDF0',
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
                                      backgroundColor: isCurrentYear ? getContributionColor(day.count) : '#EBEDF0',
                                      borderRadius: '2px',
                                      cursor: isCurrentYear ? 'pointer' : 'default',
                                      position: 'relative',
                                      flexShrink: 0,
                                    }}
                                    onMouseEnter={(e) => {
                                      if (isCurrentYear) {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setHoveredDay({
                                          date: day.date,
                                          count: day.count,
                                          x: rect.left + rect.width / 2,
                                          y: rect.top,
                                        });
                                      }
                                    }}
                                    onMouseLeave={() => setHoveredDay(null)}
                                  />
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Legend */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px', marginTop: '12px', fontSize: '10px', color: '#6C7180' }}>
                    <span>Less</span>
                    <div style={{ display: 'flex', gap: '2px' }}>
                      <div style={{ width: '11px', height: '11px', backgroundColor: '#EBEDF0', borderRadius: '2px' }}></div>
                      <div style={{ width: '11px', height: '11px', backgroundColor: '#9BE9A8', borderRadius: '2px' }}></div>
                      <div style={{ width: '11px', height: '11px', backgroundColor: '#40C463', borderRadius: '2px' }}></div>
                      <div style={{ width: '11px', height: '11px', backgroundColor: '#30A14E', borderRadius: '2px' }}></div>
                      <div style={{ width: '11px', height: '11px', backgroundColor: '#216E39', borderRadius: '2px' }}></div>
                    </div>
                    <span>More</span>
                  </div>
                </div>

                {/* Tooltip */}
                {hoveredDay && (
                  <div
                    style={{
                      position: 'fixed',
                      left: `${hoveredDay.x}px`,
                      top: `${hoveredDay.y - 40}px`,
                      backgroundColor: '#212121',
                      color: '#FFFFFF',
                      padding: '6px 8px',
                      borderRadius: '2px',
                      fontSize: '11px',
                      zIndex: 1000,
                      pointerEvents: 'none',
                      transform: 'translateX(-50%)',
                    }}
                  >
                    {hoveredDay.count} contribution{hoveredDay.count !== 1 ? 's' : ''} on {new Date(hoveredDay.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                )}
              </div>

              {/* Popular Projects Section */}
              {projects && projects.length > 0 && (
                <div style={{ marginBottom: '32px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h2 style={{ fontSize: '14px', fontWeight: 600, color: '#415C85' }}>
                      Popular projects
                    </h2>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {projects.slice(0, 6).map((project) => (
                      <div
                        key={project.id}
                        style={{
                          backgroundColor: '#FFFFFF',
                          border: '1px solid #E9E9EB',
                          borderRadius: 0,
                          padding: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#F0F6FF';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = '#FFFFFF';
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <FolderOpen className="w-3.5 h-3.5" style={{ color: '#6C7180' }} />
                            <span style={{ fontSize: '12px', fontWeight: 500, color: '#415C85' }}>
                              {project.title}
                            </span>
                            <span style={{
                              fontSize: '10px',
                              padding: '2px 6px',
                              backgroundColor: '#F9F9F9',
                              color: '#6C7180',
                              borderRadius: '2px',
                            }}>
                              {project.status}
                            </span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#6C7180', marginLeft: '20px' }}>
                            {project.client_name}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Contribution Activity List */}
              <div>
                <h2 style={{ fontSize: '14px', fontWeight: 600, color: '#415C85', marginBottom: '16px' }}>
                  Contribution activity
                </h2>
                
                {Object.keys(groupedActivities).length === 0 ? (
                  <div style={{ 
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #E9E9EB',
                    borderRadius: 0,
                    padding: '24px',
                    textAlign: 'center',
                  }}>
                    <p style={{ fontSize: '12px', color: '#6C7180' }}>No contributions yet</p>
                  </div>
                ) : (
                  Object.entries(groupedActivities).map(([month, monthActivities]) => (
                    <div key={month} style={{ marginBottom: '24px' }}>
                      <h3 style={{ fontSize: '12px', fontWeight: 600, color: '#415C85', marginBottom: '12px' }}>
                        {month}
                      </h3>
                      <div style={{ 
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #E9E9EB',
                        borderRadius: 0,
                      }}>
                        {monthActivities.map((activity, idx) => (
                          <div
                            key={`${activity.timestamp}-${activity.type}-${idx}-${activity.id || ''}`}
                            style={{
                              padding: '12px 16px',
                              borderBottom: idx < monthActivities.length - 1 ? '1px solid #E9E9EB' : 'none',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              cursor: 'pointer',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#F0F6FF';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                          >
                            {getActivityIcon(activity.type)}
                            <div style={{ flex: 1 }}>
                              <p style={{ fontSize: '12px', color: '#63748A', marginBottom: '2px' }}>
                                {activity.description}
                              </p>
                            </div>
                            <div style={{ fontSize: '11px', color: '#6C7180' }}>
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
          </div>
        </div>
      </div>

      {/* Profile Image Upload Modal */}
      <ProfileImageUpload
        isOpen={isProfileImageModalOpen}
        onClose={() => setIsProfileImageModalOpen(false)}
        onSave={async (file) => {
          const imageUrl = await uploadProfilePicture(file);
          setUserData(prev => prev ? { ...prev, profile_image: imageUrl, avatar_url: imageUrl } : null);
        }}
        onRemove={async () => {
          await removeProfilePicture();
          setUserData(prev => prev ? { ...prev, profile_image: undefined, avatar_url: undefined } : null);
        }}
        currentImageUrl={userData?.profile_image || userData?.avatar_url}
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
