import * as React from 'react';
import { ChevronDown, ChevronRight, Check, Lock } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { useModel, LLMModel } from '../contexts/ModelContext';
import { useUsageOptional } from '../contexts/UsageContext';
import { usePlanModalOptional } from '../contexts/PlanModalContext';

interface ModelSelectorProps {
  className?: string;
  compact?: boolean; // Show only icon (for very narrow view)
}

interface ModelOption {
  id: LLMModel;
  label: string;
  shortLabel: string;
  provider: 'openai' | 'anthropic' | 'google';
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
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    shortLabel: '2.5 Flash',
    provider: 'google',
  },
  {
    id: 'gemini-3.1-pro',
    label: 'Gemini 3.1 Pro',
    shortLabel: '3.1 Pro',
    provider: 'google',
  },
];

const UPGRADE_CTA_COLOR = '#388E8C';

export function ModelSelector({ className, compact = false }: ModelSelectorProps) {
  const { model, setModel } = useModel();
  const usageContext = useUsageOptional();
  const planModal = usePlanModalOptional();
  const plan = usageContext?.usage?.plan?.toLowerCase?.() ?? '';
  const billingCycleEnd = usageContext?.usage?.billing_cycle_end;
  const isStarter = plan === 'personal' || plan === 'starter';

  const [hoveredModel, setHoveredModel] = React.useState<LLMModel | null>(null);
  const didSelectRef = React.useRef(false);

  const currentModel = models.find((m) => m.id === model) || models[0];
  const displayLabel = compact ? currentModel.shortLabel : currentModel.label;
  const miniModelId: LLMModel = 'gpt-4o-mini';
  const miniTriggerColor = '#7F7F7F';
  const miniMenuColor = '#0F0F0F';
  const showText = !compact;

  const handleCtaClick = React.useCallback(() => {
    planModal?.openPlanModal(plan || 'personal', billingCycleEnd, 'professional');
  }, [planModal, plan, billingCycleEnd]);

  const dropdownContentStyle: React.CSSProperties = {
    backgroundColor: '#FFFFFF',
    border: '1px solid rgba(0, 0, 0, 0.1)',
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
    minWidth: '140px',
    paddingTop: '2px',
    paddingBottom: '2px',
  };

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
          className={`flex items-center gap-1.5 focus:outline-none outline-none hover:bg-black/[0.05] ${className || ''}`}
          style={{
            backgroundColor: 'transparent',
            color: '#525252',
            border: 'none',
            fontSize: '13px',
            fontWeight: 400,
            cursor: 'pointer',
            padding: compact ? '6px 10px 6px 6px' : '6px 12px 6px 8px',
            borderRadius: '8px',
            whiteSpace: 'nowrap',
            flexShrink: 1,
            minWidth: 0,
            overflow: 'hidden',
            transition: 'none',
          }}
        >
          {isStarter ? (
            <span style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flexShrink: 1,
              minWidth: 0,
            }}>
              Model
            </span>
          ) : (
            <>
              <div
                className="flex items-center justify-center flex-shrink-0"
                style={{
                  width: currentModel.provider === 'google' ? (compact ? 17 : 15) : (currentModel.provider === 'openai' ? (compact ? 17 : 15) : (compact ? 19 : 17)),
                  height: currentModel.provider === 'google' ? (compact ? 17 : 15) : (currentModel.provider === 'openai' ? (compact ? 17 : 15) : (compact ? 19 : 17)),
                }}
              >
                <img
                  src={currentModel.provider === 'openai' ? '/OpenAIIcon.png' : currentModel.provider === 'google' ? '/GeminiIcon.png' : '/ClaudeIcon.png'}
                  alt=""
                  style={{
                    width: currentModel.provider === 'openai' ? (compact ? 17 : 15) : (currentModel.provider === 'google' ? (compact ? 17 : 15) : (compact ? 19 : 17)),
                    height: currentModel.provider === 'openai' ? (compact ? 17 : 15) : (currentModel.provider === 'google' ? (compact ? 17 : 15) : (compact ? 19 : 17)),
                    objectFit: 'contain',
                  }}
                />
              </div>
              {showText && (
                <span style={{
                  ...(currentModel.id === miniModelId ? { color: miniTriggerColor } : {}),
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flexShrink: 1,
                  minWidth: 0,
                }}>
                  {displayLabel}
                </span>
              )}
            </>
          )}
          <ChevronDown className="w-3 h-3" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="px-0"
        style={dropdownContentStyle}
      >
        {isStarter ? (
          <>
            <DropdownMenuItem
              onClick={() => {
                didSelectRef.current = true;
                handleCtaClick();
              }}
              className="flex items-center justify-between gap-1.5 cursor-pointer min-h-0"
              style={{
                margin: '0 3px 6px',
                padding: '5px 8px',
                borderRadius: '6px',
                border: `1px solid ${UPGRADE_CTA_COLOR}`,
                backgroundColor: `${UPGRADE_CTA_COLOR}14`,
                color: UPGRADE_CTA_COLOR,
                fontSize: '11px',
                fontWeight: 500,
                minHeight: 'unset',
              }}
            >
              <span>Access the top AI models</span>
              <ChevronRight className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
            </DropdownMenuItem>
            {models.map((modelOption) => (
              <HoverCard key={modelOption.id} openDelay={200} closeDelay={100}>
                <HoverCardTrigger asChild>
                  <DropdownMenuItem
                    disabled
                    onSelect={(e) => e.preventDefault()}
                    className="flex items-center gap-1.5 min-h-0 data-[disabled]:pointer-events-auto data-[disabled]:opacity-100"
                    style={{
                      paddingTop: '4px',
                      paddingBottom: '4px',
                      paddingLeft: '8px',
                      paddingRight: '8px',
                      margin: '0 3px',
                      borderRadius: '6px',
                      color: '#9CA3AF',
                      fontSize: '11px',
                      fontWeight: 400,
                      opacity: 0.85,
                      minHeight: 'unset',
                    }}
                  >
                    <div
                      className="flex items-center justify-center flex-shrink-0"
                      style={{ width: 16, height: 16 }}
                    >
                      <img
                        src={modelOption.provider === 'openai' ? '/OpenAIIcon.png' : modelOption.provider === 'google' ? '/GeminiIcon.png' : '/ClaudeIcon.png'}
                        alt=""
                        style={{
                          width: modelOption.provider === 'openai' ? 13 : (modelOption.provider === 'google' ? 14 : 15),
                          height: modelOption.provider === 'openai' ? 13 : (modelOption.provider === 'google' ? 14 : 15),
                          objectFit: 'contain',
                        }}
                      />
                    </div>
                    <span className="flex-1">{modelOption.label}</span>
                    <Lock className="w-2.5 h-2.5 flex-shrink-0" strokeWidth={2} style={{ opacity: 0.7 }} />
                  </DropdownMenuItem>
                </HoverCardTrigger>
                <HoverCardContent
                  side="right"
                  align="start"
                  sideOffset={8}
                  className="z-[10060] w-[220px] p-0 rounded-lg shadow-lg border border-gray-200 bg-white"
                >
                  <div className="p-3 flex flex-col gap-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-gray-200 text-gray-700"
                      >
                        Pro
                      </span>
                      <span className="font-semibold text-[11px] text-gray-900">
                        Access the top AI models
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-600 leading-relaxed">
                      Access the latest AI models from<br />
                      OpenAI, Anthropic (Claude), Google (Gemini) and more
                    </p>
                    <p className="text-[11px] text-gray-600 leading-relaxed">
                      by{' '}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          didSelectRef.current = true;
                          handleCtaClick();
                        }}
                        className="cursor-pointer hover:underline bg-transparent border-0 p-0 font-inherit text-blue-900"
                      >
                        upgrading your plan today
                      </button>
                    </p>
                  </div>
                </HoverCardContent>
              </HoverCard>
            ))}
          </>
        ) : (
          models.map((modelOption) => {
            const isSelected = model === modelOption.id;
            const isHovered = hoveredModel === modelOption.id;
            const showSelectionColor = isHovered || (isSelected && hoveredModel === null);

            return (
              <DropdownMenuItem
                key={modelOption.id}
                onClick={() => {
                  didSelectRef.current = true;
                  setModel(modelOption.id);
                }}
                className="flex items-center gap-1.5 cursor-pointer min-h-0"
                style={{
                  backgroundColor: showSelectionColor ? 'rgba(0, 0, 0, 0.04)' : 'transparent',
                  color: '#1A1A1A',
                  fontSize: '11px',
                  fontWeight: 400,
                  borderRadius: '6px',
                  paddingTop: '4px',
                  paddingBottom: '4px',
                  paddingLeft: '8px',
                  paddingRight: '8px',
                  margin: '0 3px',
                  minHeight: 'unset',
                  transition: 'none',
                }}
                onMouseEnter={() => setHoveredModel(modelOption.id)}
              >
                <div
                  className="flex items-center justify-center flex-shrink-0"
                  style={{ width: 16, height: 16 }}
                >
                  <img
                    src={modelOption.provider === 'openai' ? '/OpenAIIcon.png' : modelOption.provider === 'google' ? '/GeminiIcon.png' : '/ClaudeIcon.png'}
                    alt=""
                    style={{
                      width: modelOption.provider === 'openai' ? 13 : (modelOption.provider === 'google' ? 14 : 15),
                      height: modelOption.provider === 'openai' ? 13 : (modelOption.provider === 'google' ? 14 : 15),
                      objectFit: 'contain',
                    }}
                  />
                </div>
                <span
                  className="flex-1"
                  style={modelOption.id === miniModelId ? { color: miniMenuColor } : undefined}
                >
                  {modelOption.label}
                </span>
                {isSelected && <Check className="w-2.5 h-2.5 flex-shrink-0" strokeWidth={2.5} style={{ opacity: 0.7 }} />}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ModelSelector;
