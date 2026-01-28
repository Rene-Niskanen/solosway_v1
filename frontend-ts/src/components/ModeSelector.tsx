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

  const showText = large || !compact; // Always show text when large, otherwise show unless compact (icon only)
  const textSize = small ? '10px' : '12px'; // Use default text size (12px) when large, smaller (10px) when small
  const iconSize = compact ? "w-4 h-4" : "w-3.5 h-3.5"; // Default icon size
  const buttonHeight = '22px'; // Default button height (2px higher than 20px)
  const gapClass = showText ? 'gap-1.5' : ''; // Add gap when showing text
  const paddingClass = compact ? 'px-2 py-0.5' : 'px-2.5 py-0.5'; // Padding without gap (gap is separate) - reduced py from 1 to 0.5
  
  // Set background color based on mode: beige for Agent, light grey for Reader
  const backgroundColor = mode === 'agent' ? '#F2DEB6' : '#E5E7EB'; // Light grey for Reader
  // Set text and icon color: darker orange for Agent, black for Reader
  const textColor = mode === 'agent' ? '#78350F' : '#1A1A1A'; // Darker orange for Agent, black for Reader
  const iconColor = mode === 'agent' ? '#78350F' : '#1A1A1A'; // Darker orange for Agent, black for Reader

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
          className={`flex items-center ${gapClass} ${paddingClass} rounded-full focus:outline-none outline-none ${className || ''}`}
          style={{
            backgroundColor: backgroundColor,
            color: textColor,
            border: mode === 'agent' ? '1px solid rgba(229, 231, 235, 0.6)' : 'none',
            fontSize: textSize,
            fontWeight: 500,
            cursor: 'pointer',
            height: buttonHeight,
            minHeight: buttonHeight,
            transition: 'none',
          }}
        >
          <CurrentIcon className={iconSize} strokeWidth={2} style={{ color: iconColor }} />
          {showText && <span className="text-xs font-medium">{currentMode.label}</span>}
          {showText && <ChevronDown className="w-3 h-3 opacity-50" strokeWidth={2} style={{ color: iconColor }} />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="p-0"
        style={{
          backgroundColor: '#FDF6ED',
          border: '1px solid rgba(244, 192, 133, 0.3)',
          borderRadius: '4px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
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
                backgroundColor: showSelectionColor ? 'rgba(0, 0, 0, 0.05)' : 'transparent',
                color: '#4A4A4A',
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
