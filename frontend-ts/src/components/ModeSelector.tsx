import * as React from 'react';
import { useEffect } from 'react';
import { Glasses, Infinity, ChevronDown, Check, ClipboardList } from 'lucide-react';
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
  large?: boolean; // Make button larger (for initial map render)
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
  {
    id: 'plan',
    label: 'Plan',
    icon: ClipboardList,
    shortcut: '⌘P',
    shortcutKey: 'p',
  },
];

export function ModeSelector({ className, compact = false, small = false, large = false }: ModeSelectorProps) {
  const { mode, setMode } = useMode();
  const currentMode = modes.find((m) => m.id === mode) || modes[0];
  const CurrentIcon = currentMode.icon;
  const [hoveredMode, setHoveredMode] = React.useState<AgentMode | null>(null);
  const didSelectRef = React.useRef(false);

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

  const showText = large || !compact;
  const iconSize = compact ? "w-4 h-4" : "w-3.5 h-3.5";
  const textColor = '#525252';
  const iconColor = '#525252';

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          didSelectRef.current = false;
          return;
        }
        if (!didSelectRef.current) {
          setHoveredMode(null);
        }
        didSelectRef.current = false;
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center gap-1.5 focus:outline-none outline-none hover:bg-black/[0.05] ${className || ''}`}
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.03)',
            color: textColor,
            border: 'none',
            fontSize: '13px',
            fontWeight: 400,
            cursor: 'pointer',
            padding: compact ? '6px 8px' : '6px 10px',
            borderRadius: '8px',
            transition: 'none',
          }}
        >
          <CurrentIcon className={iconSize} strokeWidth={2} style={{ color: iconColor }} />
          {showText && <span>{currentMode.label}</span>}
          {showText && <ChevronDown className="w-3 h-3" strokeWidth={2} style={{ color: iconColor }} />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="p-0"
        style={{
          backgroundColor: '#FFFFFF',
          border: '1px solid #E5E5E5',
          borderRadius: '4px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
          minWidth: '150px',
        }}
      >
        {modes.map((modeOption) => {
          const Icon = modeOption.icon;
          const isSelected = mode === modeOption.id;
          const isHovered = hoveredMode === modeOption.id;
          // Show selection color on hovered item, or on selected item if nothing is hovered
          const showSelectionColor = isHovered || (isSelected && hoveredMode === null);
          
          return (
            <DropdownMenuItem
              key={modeOption.id}
              onClick={() => {
                didSelectRef.current = true;
                setMode(modeOption.id);
              }}
              className="flex items-center gap-1.5 pl-2 pr-2.5 cursor-pointer"
              style={{
                backgroundColor: showSelectionColor ? '#F5F5F5' : 'transparent',
                color: '#404040',
                fontSize: '11px',
                fontWeight: 400,
                borderRadius: '2px',
                paddingTop: '4px',
                paddingBottom: '4px',
                transition: 'none',
              }}
              onMouseEnter={() => {
                setHoveredMode(modeOption.id);
              }}
            >
              <Icon className="w-3 h-3" strokeWidth={1.75} style={{ opacity: 0.8 }} />
              <span className="flex-1">{modeOption.label}</span>
              <div className="flex items-center justify-end" style={{ width: '45px', gap: '4px' }}>
              <span 
                style={{ 
                  fontSize: '10px', 
                  opacity: 0.5,
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                    display: 'inline-block',
                    textAlign: 'right',
                }}
              >
                {modeOption.shortcut}
              </span>
                <div style={{ width: isSelected ? '12px' : '0px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {isSelected && <Check className="w-3 h-3" strokeWidth={2.5} style={{ opacity: 0.7 }} />}
                </div>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ModeSelector;
