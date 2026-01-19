"use client";

import * as React from "react";
import { backendApi, ProjectData, CreateProjectData } from "@/services/backendApi";

interface ProjectsContextType {
  projects: ProjectData[];
  isLoading: boolean;
  error: string | null;
  activeFilter: 'active' | 'negotiating' | 'archived' | null;
  setActiveFilter: (filter: 'active' | 'negotiating' | 'archived' | null) => void;
  fetchProjects: (status?: 'active' | 'negotiating' | 'archived') => Promise<void>;
  createProject: (data: CreateProjectData) => Promise<ProjectData | null>;
  updateProject: (projectId: string, data: Partial<CreateProjectData>) => Promise<ProjectData | null>;
  deleteProject: (projectId: string) => Promise<boolean>;
  getProjectById: (projectId: string) => ProjectData | undefined;
  refreshProjects: () => Promise<void>;
}

const ProjectsContext = React.createContext<ProjectsContextType | undefined>(undefined);

export const useProjects = () => {
  const context = React.useContext(ProjectsContext);
  if (!context) {
    throw new Error('useProjects must be used within a ProjectsProvider');
  }
  return context;
};

interface ProjectsProviderProps {
  children: React.ReactNode;
}

export const ProjectsProvider: React.FC<ProjectsProviderProps> = ({ children }) => {
  const [projects, setProjects] = React.useState<ProjectData[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [activeFilter, setActiveFilter] = React.useState<'active' | 'negotiating' | 'archived' | null>(null);

  const fetchProjects = React.useCallback(async (status?: 'active' | 'negotiating' | 'archived') => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await backendApi.getProjects(status);
      if (response.success && response.data) {
        // Ensure projects is always an array
        const projectsList = response.data.projects;
        setProjects(Array.isArray(projectsList) ? projectsList : []);
      } else {
        // If the table doesn't exist yet, treat it as empty projects (not an error)
        // This provides a better UX - user sees "No projects yet" instead of an error
        const errorMsg = response.error || '';
        if (errorMsg.includes('UndefinedTable') || errorMsg.includes('does not exist')) {
          console.warn('Projects table not initialized yet - showing empty state');
          setProjects([]);
          // Don't set error - just show empty state
        } else {
          setError(response.error || 'Failed to fetch projects');
          setProjects([]); // Ensure projects is always an array even on error
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error occurred';
      // Same handling for caught exceptions
      if (errorMsg.includes('UndefinedTable') || errorMsg.includes('does not exist')) {
        console.warn('Projects table not initialized yet - showing empty state');
        setProjects([]);
      } else {
        setError(errorMsg);
        setProjects([]); // Ensure projects is always an array even on error
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createProject = React.useCallback(async (data: CreateProjectData): Promise<ProjectData | null> => {
    setError(null);
    
    try {
      const response = await backendApi.createProject(data);
      if (response.success && response.data) {
        // Add the new project to the list
        setProjects(prev => [response.data!, ...prev]);
        return response.data;
      } else {
        setError(response.error || 'Failed to create project');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      return null;
    }
  }, []);

  const updateProject = React.useCallback(async (
    projectId: string, 
    data: Partial<CreateProjectData>
  ): Promise<ProjectData | null> => {
    setError(null);
    
    try {
      const response = await backendApi.updateProject(projectId, data);
      if (response.success && response.data) {
        // Update the project in the list
        setProjects(prev => 
          prev.map(p => p.id === projectId ? response.data! : p)
        );
        return response.data;
      } else {
        setError(response.error || 'Failed to update project');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      return null;
    }
  }, []);

  const deleteProject = React.useCallback(async (projectId: string): Promise<boolean> => {
    setError(null);
    
    try {
      const response = await backendApi.deleteProject(projectId);
      if (response.success) {
        // Remove the project from the list
        setProjects(prev => prev.filter(p => p.id !== projectId));
        return true;
      } else {
        setError(response.error || 'Failed to delete project');
        return false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      return false;
    }
  }, []);

  const getProjectById = React.useCallback((projectId: string): ProjectData | undefined => {
    return projects.find(p => p.id === projectId);
  }, [projects]);

  const refreshProjects = React.useCallback(async () => {
    await fetchProjects(activeFilter ?? undefined);
  }, [fetchProjects, activeFilter]);

  // Fetch projects when filter changes
  React.useEffect(() => {
    fetchProjects(activeFilter ?? undefined);
  }, [activeFilter, fetchProjects]);

  const value: ProjectsContextType = {
    projects,
    isLoading,
    error,
    activeFilter,
    setActiveFilter,
    fetchProjects,
    createProject,
    updateProject,
    deleteProject,
    getProjectById,
    refreshProjects
  };

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
};

export default ProjectsContext;
