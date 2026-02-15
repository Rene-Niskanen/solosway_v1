"use client";

import * as React from "react";
import { Calendar, MessageCircle, MoreHorizontal } from "lucide-react";
import { ProjectData } from "@/services/backendApi";

// Tool icons mapping
const TOOL_ICONS: Record<string, string> = {
  'Figma': '🎨',
  'Sketch': '💎',
  'Adobe XD': '🎯',
  'Photoshop': '📷',
  'Illustrator': '✏️',
  'InDesign': '📰',
  'Webflow': '🌐',
  'Framer': '🖼️',
};

// Status colors
const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  active: { bg: 'rgba(34, 197, 94, 0.1)', text: '#16a34a', border: 'rgba(34, 197, 94, 0.3)' },
  negotiating: { bg: 'rgba(234, 179, 8, 0.1)', text: '#ca8a04', border: 'rgba(234, 179, 8, 0.3)' },
  archived: { bg: 'rgba(156, 163, 175, 0.1)', text: '#6b7280', border: 'rgba(156, 163, 175, 0.3)' },
};

interface ProjectCardProps {
  project: ProjectData;
  onClick?: () => void;
  onMenuClick?: (e: React.MouseEvent) => void;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  onClick,
  onMenuClick
}) => {
  // Format budget display
  const formatBudget = (min?: number, max?: number) => {
    if (!min && !max) return null;
    const formatNum = (n: number) => {
      // Convert cents to dollars
      const dollars = n / 100;
      if (dollars >= 1000) {
        return `$${(dollars / 1000).toFixed(dollars % 1000 === 0 ? 0 : 1)}k`;
      }
      return `$${dollars.toLocaleString()}`;
    };
    if (min && max) {
      return `${formatNum(min)} - ${formatNum(max)}`;
    }
    return min ? formatNum(min) : max ? formatNum(max) : null;
  };

  // Format date display
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  // Format created date for header
  const formatCreatedDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const statusStyle = STATUS_COLORS[project.status] || STATUS_COLORS.active;
  const toolIcon = project.tool ? TOOL_ICONS[project.tool] || '🔧' : null;

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-lg group"
      style={{
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.05)',
        border: '1px solid rgba(0, 0, 0, 0.06)',
      }}
    >
      {/* Header: Client info + Status + Menu */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Client Logo/Avatar */}
          <div 
            className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0"
            style={{ border: '1px solid rgba(0, 0, 0, 0.08)' }}
          >
            {project.client_logo_url ? (
              <img 
                src={project.client_logo_url} 
                alt={project.client_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-sm font-semibold text-gray-600">
                {project.client_name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          
          {/* Client Name + Date */}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {project.client_name}
            </p>
            <p className="text-xs text-gray-500">
              {formatCreatedDate(project.created_at)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status Badge */}
          <span
            className="px-2.5 py-1 text-xs font-medium rounded-full capitalize"
            style={{
              backgroundColor: statusStyle.bg,
              color: statusStyle.text,
              border: `1px solid ${statusStyle.border}`,
            }}
          >
            {project.status}
          </span>

          {/* Menu Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMenuClick?.(e);
            }}
            className="p-1.5 rounded-full hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100"
          >
            <MoreHorizontal className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      </div>

      {/* Thumbnail */}
      <div 
        className="w-full aspect-[16/10] bg-gray-50 overflow-hidden"
        style={{ borderTop: '1px solid rgba(0, 0, 0, 0.04)', borderBottom: '1px solid rgba(0, 0, 0, 0.04)' }}
      >
        {project.thumbnail_url ? (
          <img
            src={project.thumbnail_url}
            alt={project.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <img
            src="/defaultproject.png"
            alt={project.title}
            className="w-full h-full object-cover"
          />
        )}
      </div>

      {/* Content */}
      <div className="px-4 py-4">
        {/* Title */}
        <h3 className="text-base font-semibold text-gray-900 line-clamp-2 mb-3" style={{ lineHeight: '1.4' }}>
          {project.title}
        </h3>

        {/* Tags */}
        {project.tags && project.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {project.tags.slice(0, 3).map((tag, index) => (
              <span
                key={index}
                className="px-2 py-0.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md"
              >
                {tag}
              </span>
            ))}
            {project.tags.length > 3 && (
              <span className="px-2 py-0.5 text-xs font-medium text-gray-500">
                +{project.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Meta Info */}
        <div className="space-y-2 text-sm text-gray-600">
          {/* Tool */}
          {project.tool && (
            <div className="flex items-center gap-2">
              <span>{toolIcon}</span>
              <span className="font-medium">{project.tool}</span>
            </div>
          )}

          {/* Budget */}
          {(project.budget_min || project.budget_max) && (
            <div className="flex items-center gap-2">
              <span className="text-gray-400">💰</span>
              <span className="font-medium">{formatBudget(project.budget_min, project.budget_max)}</span>
            </div>
          )}

          {/* Due Date */}
          {project.due_date && (
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span>Due {formatDate(project.due_date)}</span>
            </div>
          )}

          {/* Messages */}
          {project.message_count > 0 && (
            <div className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-gray-400" />
              <span>{project.message_count} New Message{project.message_count !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectCard;
