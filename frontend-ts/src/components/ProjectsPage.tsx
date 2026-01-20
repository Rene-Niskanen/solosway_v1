"use client";

import * as React from "react";
import { Plus, Zap, Clock, Archive, FolderOpen } from "lucide-react";
import { useProjects } from "@/contexts/ProjectsContext";
import { ProjectCard } from "./ProjectCard";

interface ProjectsPageProps {
  onCreateProject: () => void;
  sidebarWidth?: number;
}

type TabType = 'active' | 'negotiating' | 'archived';

interface Tab {
  id: TabType;
  label: string;
  icon: React.ComponentType<any>;
}

const TABS: Tab[] = [
  { id: 'active', label: 'Active', icon: Zap },
  { id: 'negotiating', label: 'Negotiating', icon: Clock },
  { id: 'archived', label: 'Archived', icon: Archive },
];

export const ProjectsPage: React.FC<ProjectsPageProps> = ({ onCreateProject, sidebarWidth = 0 }) => {
  const { projects, isLoading, error, activeFilter, setActiveFilter } = useProjects();
  const [activeTab, setActiveTab] = React.useState<TabType>('active');

  // Sync tab with context filter
  React.useEffect(() => {
    if (activeFilter) {
      setActiveTab(activeFilter);
    }
  }, [activeFilter]);

  // Update filter when tab changes
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setActiveFilter(tab);
  };

  // Filter projects based on active tab
  const filteredProjects = React.useMemo(() => {
    if (!projects || !Array.isArray(projects)) {
      return [];
    }
    return projects.filter(p => p.status === activeTab);
  }, [projects, activeTab]);

  // Check if there are any projects at all (across all statuses)
  const hasAnyProjects = projects && Array.isArray(projects) && projects.length > 0;

  // Empty state - minimal, Claude/OpenAI-inspired design
  const InitialEmptyState = () => (
    <div 
      className="fixed flex flex-col items-center justify-center"
      style={{
        top: 0,
        left: sidebarWidth,
        right: 0,
        bottom: 0,
      }}
    >
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-5">
        <FolderOpen className="w-8 h-8 text-gray-400" strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold text-gray-800 mb-1.5">No projects yet.</h3>
      <p style={{ fontSize: '13px', color: '#71717A', marginBottom: '20px' }}>
        No project? Let's change that. Create one now.
      </p>
      <button
        onClick={onCreateProject}
        className="px-3 py-1.5 bg-white text-gray-800 text-sm font-medium rounded-none transition-all duration-150 hover:bg-gray-50"
        style={{
          border: '1px solid rgba(0, 0, 0, 0.15)',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
        }}
      >
        Create Project
      </button>
    </div>
  );

  // Empty state for filtered view (when there are projects, but none in this tab)
  const FilteredEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mb-4">
        <FolderOpen className="w-8 h-8 text-gray-300" strokeWidth={1.5} />
      </div>
      <h3 style={{ fontSize: '15px', fontWeight: 500, color: '#3F3F46', marginBottom: '4px' }}>
        No {activeTab} projects
      </h3>
      <p style={{ fontSize: '13px', color: '#A1A1AA' }}>
        Projects with "{activeTab}" status will appear here.
      </p>
    </div>
  );

  // Show loading state
  if (isLoading) {
    return (
      <div 
        className="w-full h-full flex items-center justify-center min-h-[60vh]"
        style={{
          paddingLeft: `${sidebarWidth}px`,
        }}
      >
        <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
      </div>
    );
  }

  // Show error state (for real errors, not "table doesn't exist")
  if (error) {
    return (
      <div 
        className="w-full h-full flex flex-col items-center justify-center min-h-[60vh]"
        style={{
          paddingLeft: `${sidebarWidth}px`,
        }}
      >
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={() => setActiveFilter(activeTab)}
          className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg hover:bg-gray-200 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Show initial empty state when there are no projects at all
  if (!hasAnyProjects) {
    return <InitialEmptyState />;
  }

  // Show full page with tabs when there are projects
  return (
    <div 
      className="w-full max-w-7xl mx-auto py-8"
      style={{
        paddingLeft: `max(${sidebarWidth + 24}px, 1.5rem)`, // sidebar width + default padding (24px = 1.5rem)
        paddingRight: '1.5rem',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 style={{ fontSize: '20px', fontWeight: 600, color: '#18181B', letterSpacing: '-0.02em' }}>Projects</h1>
        <button
          onClick={onCreateProject}
          className="px-3 py-1.5 bg-white text-gray-800 text-sm font-medium rounded-none transition-all duration-150 hover:bg-gray-50"
          style={{
            border: '1px solid rgba(0, 0, 0, 0.15)',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
          }}
        >
          Create Project
        </button>
      </div>

      {/* Tabs - minimal pill design */}
      <div className="flex items-center gap-1 mb-6">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className="flex items-center gap-1.5 transition-all duration-150"
              style={{
                padding: '6px 12px',
                backgroundColor: isActive ? '#18181B' : 'transparent',
                color: isActive ? 'white' : '#71717A',
                fontSize: '13px',
                fontWeight: 500,
                borderRadius: '6px',
                border: isActive ? 'none' : '1px solid #E4E4E7',
              }}
            >
              <Icon style={{ width: '14px', height: '14px' }} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      {filteredProjects.length === 0 ? (
        <FilteredEmptyState />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onClick={() => {
                // TODO: Navigate to project details
                console.log('Open project:', project.id);
              }}
              onMenuClick={(e) => {
                e.stopPropagation();
                // TODO: Show project menu
                console.log('Menu clicked for project:', project.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ProjectsPage;
