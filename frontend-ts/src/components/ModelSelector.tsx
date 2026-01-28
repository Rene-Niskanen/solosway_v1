import * as React from 'react';
import { ChevronDown, Check, Sparkles } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useModel, LLMModel } from '../contexts/ModelContext';

interface ModelSelectorProps {
  className?: string;
  compact?: boolean; // Show only icon (for very narrow view)
}

interface ModelOption {
  id: LLMModel;
  label: string;
  shortLabel: string;
  provider: 'openai' | 'anthropic';
}

// Available models - easy to extend later
const models: ModelOption[] = [
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    shortLabel: 'GPT-4o mini',
    provider: 'openai',
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    shortLabel: 'GPT-4o',
    provider: 'openai',
  },
  {
    id: 'claude-sonnet',
    label: 'Sonnet 4',
    shortLabel: 'Sonnet 4',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus',
    label: 'Opus 4',
    shortLabel: 'Opus 4',
    provider: 'anthropic',
  },
];

export function ModelSelector({ className, compact = false }: ModelSelectorProps) {
  const { model, setModel } = useModel();
  const currentModel = models.find((m) => m.id === model) || models[0];
  const [hoveredModel, setHoveredModel] = React.useState<LLMModel | null>(null);
  const didSelectRef = React.useRef(false);

  const displayLabel = compact ? currentModel.shortLabel : currentModel.label;
  const textSize = '13px';
  const buttonHeight = '24px';
  const miniModelId: LLMModel = 'gpt-4o-mini';
  const miniTriggerColor = '#7F7F7F';
  const miniMenuColor = '#0F0F0F';
  
  // Icon-only mode styling
  const showText = !compact;
  const iconSize = compact ? "w-3.5 h-3.5" : "w-3 h-3";
  const gapClass = showText ? 'gap-1' : '';
  const paddingClass = compact ? 'px-1.5 py-0.5' : 'px-2.5 py-1';

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          didSelectRef.current = false;
          return;
        }
        if (!didSelectRef.current) {
          setHoveredModel(null);
        }
        didSelectRef.current = false;
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center ${gapClass} ${paddingClass} rounded-full focus:outline-none outline-none ${className || ''}`}
          style={{
            backgroundColor: 'transparent',
            color: '#9D9D9D',
            border: 'none',
            fontSize: textSize,
            fontWeight: 400,
            cursor: 'pointer',
            height: buttonHeight,
            minHeight: buttonHeight,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {compact && <Sparkles className={iconSize} strokeWidth={2} style={{ color: '#9D9D9D' }} />}
          {showText && (
            <span style={currentModel.id === miniModelId ? { color: miniTriggerColor } : undefined}>
              {displayLabel}
            </span>
          )}
          <ChevronDown className="w-3 h-3" strokeWidth={2} style={{ color: '#9D9D9D' }} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="p-0"
        style={{
          backgroundColor: '#FFFFFF',
          border: '1px solid rgba(0, 0, 0, 0.1)',
          borderRadius: '6px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
          minWidth: '130px',
        }}
      >
        {models.map((modelOption) => {
          const isSelected = model === modelOption.id;
          const isHovered = hoveredModel === modelOption.id;
          // Show selection color on hovered item, or on selected item if nothing is hovered
          const showSelectionColor = isHovered || (isSelected && hoveredModel === null);
          
          return (
            <DropdownMenuItem
              key={modelOption.id}
              onClick={() => {
                didSelectRef.current = true;
                setModel(modelOption.id);
              }}
              className="flex items-center gap-1.5 px-2 cursor-pointer"
              style={{
                backgroundColor: showSelectionColor ? 'rgba(0, 0, 0, 0.04)' : 'transparent',
                color: '#1A1A1A',
                fontSize: '11px',
                fontWeight: 400,
                borderRadius: '4px',
                paddingTop: '4px',
                paddingBottom: '4px',
                margin: '1px 3px',
                transition: 'none',
              }}
              onMouseEnter={() => {
                setHoveredModel(modelOption.id);
              }}
            >
              <span
                className="flex-1"
                style={modelOption.id === miniModelId ? { color: miniMenuColor } : undefined}
              >
                {modelOption.label}
              </span>
              <div style={{ width: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {isSelected && <Check className="w-3 h-3" strokeWidth={2.5} style={{ opacity: 0.7 }} />}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ModelSelector;
