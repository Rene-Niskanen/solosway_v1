import * as React from 'react';
import { useEffect } from 'react';
import { Glasses, Infinity, ChevronDown, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMode, AgentMode } from '@/contexts/ModeContext';

interface ModeSelectorProps {
  className?: string;
  compact?: boolean; // Show only icon (for very narrow view)
  small?: boolean; // Show icon + text but with smaller text (for 50/50 split view)
}

const modes: { id: AgentMode; label: string; icon: React.ElementType; shortcut: string; shortcutKey: string }[] = [
  {
    id: 'agent',
    label: 'Agent',
    icon: Infinity,
    shortcut: '⌘A',
    shortcutKey: 'a',
  },
  {
    id: 'reader',
    label: 'Reader',
    icon: Glasses,
    shortcut: '⌘R',
    shortcutKey: 'r',
  },
];

export function ModeSelector({ className, compact = false, small = false }: ModeSelectorProps) {
  const { mode, setMode } = useMode();
  const currentMode = modes.find((m) => m.id === mode) || modes[0];
  const CurrentIcon = currentMode.icon;

  // Keyboard shortcuts (Cmd+A for Agent, Cmd+R for Reader)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        const modeForKey = modes.find(m => m.shortcutKey === e.key.toLowerCase());
        if (modeForKey) {
          e.preventDefault();
          setMode(modeForKey.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setMode]);

  const showText = !compact; // Show text unless compact (icon only)
  const textSize = small ? '11px' : '13px'; // Smaller text in 50/50 split view

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center ${compact ? 'px-2 py-1.5' : 'gap-1.5 px-2.5 py-1'} rounded-full transition-all duration-200 focus:outline-none outline-none ${className || ''}`}
          style={{
            backgroundColor: '#F4C085',
            color: '#1A1A1A',
            border: 'none',
            fontSize: textSize,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <CurrentIcon className={compact ? "w-4 h-4" : "w-3.5 h-3.5"} strokeWidth={2} />
          {showText && <span>{currentMode.label}</span>}
          {showText && <ChevronDown className="w-3 h-3 opacity-50 ml-0.5" strokeWidth={2} />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="p-0.5"
        style={{
          backgroundColor: '#FDF6ED',
          border: '1px solid rgba(244, 192, 133, 0.3)',
          borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
          minWidth: '150px',
        }}
      >
        {modes.map((modeOption) => {
          const Icon = modeOption.icon;
          const isSelected = mode === modeOption.id;
          return (
            <DropdownMenuItem
              key={modeOption.id}
              onClick={() => setMode(modeOption.id)}
              className="flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-md cursor-pointer transition-colors"
              style={{
                backgroundColor: isSelected ? 'rgba(0, 0, 0, 0.05)' : 'transparent',
                color: '#4A4A4A',
                fontSize: '11px',
                fontWeight: 400,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = isSelected ? 'rgba(0, 0, 0, 0.05)' : 'transparent';
              }}
            >
              <Icon className="w-3 h-3" strokeWidth={1.75} style={{ opacity: 0.8 }} />
              <span className="flex-1">{modeOption.label}</span>
              <span 
                style={{ 
                  fontSize: '10px', 
                  opacity: 0.5,
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  marginLeft: '8px',
                  marginRight: isSelected ? '4px' : '0',
                }}
              >
                {modeOption.shortcut}
              </span>
              {isSelected && <Check className="w-3 h-3" strokeWidth={2.5} style={{ opacity: 0.7 }} />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ModeSelector;
