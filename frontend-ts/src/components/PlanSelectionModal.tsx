"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  TIERS,
  type TierKey,
  getLocaleCurrency,
  getPriceForTier,
  formatPrice,
} from "@/config/billing";
import { useCurrencyOptional, CURRENCY_OPTIONS } from "@/contexts/CurrencyContext";
import {
  ChevronDown,
  BookOpen,
  Sparkles,
  MessageSquare,
  Search,
  Receipt,
  Cpu,
  Cloud,
  Zap,
  Briefcase,
  Users,
  Headphones,
  CreditCard,
  X,
  type LucideIcon,
} from "lucide-react";

const TIER_ORDER: TierKey[] = ["personal", "professional", "business"];

/** Normalize API/context plan string to TierKey for comparison and indexOf. */
function normalizePlan(plan: string | null | undefined): TierKey {
  if (!plan || typeof plan !== "string") return "professional";
  const p = plan.trim().toLowerCase();
  if (p === "pro" || p === "professional") return "professional";
  if (p === "starter" || p === "personal") return "personal";
  if (p === "business") return "business";
  return TIER_ORDER.includes(p as TierKey) ? (p as TierKey) : "professional";
}

function formatBillingCycleEnd(s: string | undefined): string | null {
  if (!s || typeof s !== "string") return null;
  try {
    const d = new Date(s + "T12:00:00Z");
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return null;
  }
}

/** Single-container currency dropdown: trigger + list in one wrapper, no portal, so it always joins. */
function CurrencyDropdown({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const selected = CURRENCY_OPTIONS.find((o) => o.value === value) ?? CURRENCY_OPTIONS[0];

  return (
    <div ref={containerRef} className="relative w-[72px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-6 w-full items-center justify-between border border-gray-200 pl-1.5 pr-0.5 gap-0.5 text-xs text-gray-900 focus:ring-1 focus:ring-gray-300 focus:ring-offset-0 ${
          open
            ? "rounded-t-md rounded-b-none border-b-0 bg-gray-50"
            : "rounded-md bg-white"
        }`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Currency"
      >
        <span className="truncate">{selected.label}</span>
        <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-50" />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-[200] rounded-b-md rounded-t-none border border-gray-200 border-t-0 bg-white py-0.5 text-xs text-gray-900 shadow-none"
          style={{ marginTop: 0 }}
        >
          {CURRENCY_OPTIONS.filter((opt) => opt.value !== value).map((opt) => (
            <li
              key={opt.value}
              role="option"
              onClick={() => {
                onValueChange(opt.value);
                setOpen(false);
              }}
              className="flex cursor-default items-center px-1.5 py-0.5 first:pt-0.5 last:pb-0.5 hover:bg-gray-50 text-gray-900"
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


/** Benefit-led taglines (ChatGPT-style: short, clear, one idea per tier). */
const SLOGANS: Record<TierKey, string> = {
  personal: "Get started with AI on your documents.",
  professional: "More access to advanced extraction.",
  business: "Maximize your team's intelligence.",
};

/** Feature lines per tier. Progression: explore/get started → more/solve → scale/maximize. */
const FEATURES_BASE: Record<TierKey, string[]> = {
  personal: [
    "500 pages processed per month",
    "Extract key facts from every document",
    "Ask your docs anything—answers cite their sources",
    "Search and organise in one place",
    "Ideal for receipts, tax, insurance, contracts",
  ],
  professional: [
    "2,000 pages per month",
    "Choose your AI model—optimise for speed, depth, or cost",
    "More cloud storage for documents and history",
    "Priority processing",
    "Extended semantic search and chat across your full document set",
    "For freelancers, consultants, and solo professionals",
  ],
  business: [
    "5,000 pages per month in a shared pool",
    "Model selection for every team member",
    "Largest cloud storage—team-wide",
    "Multiple users, one allowance—use it where it matters",
    "Dedicated support agent",
    "2× faster processing speeds",
    "Extend your page limit",
    "For small teams (3–10 people)",
  ],
};

/** Icons for each feature (same order as FEATURES_BASE). Same concept = same icon across tiers. */
const FEATURE_ICONS: Record<TierKey, LucideIcon[]> = {
  personal: [BookOpen, Sparkles, MessageSquare, Search, Receipt],
  professional: [BookOpen, Cpu, Cloud, Zap, Search, Briefcase],
  business: [BookOpen, Cpu, Cloud, Users, Headphones, Zap, CreditCard, Users],
};

function getFeaturesForTier(tierId: TierKey, _currency: string): string[] {
  return FEATURES_BASE[tierId];
}

const iconClassName = "h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-500";

/** Renders the feature icon for a tier and index so Lucide Icon always receives a valid component. */
function FeatureIcon({ tierId, index }: { tierId: TierKey; index: number }) {
  const Icon = FEATURE_ICONS[tierId]?.[index];
  if (!Icon) return <span className={iconClassName} aria-hidden />;
  return <Icon className={iconClassName} size={14} strokeWidth={2} aria-hidden />;
}

export interface PlanSelectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan: string;
  fullscreen?: boolean;
  onUpgrade?: (tier: TierKey) => void;
  onSwitch?: (tier: TierKey) => void;
  /** For reassurance copy: "You can keep using your current plan limit until [date]" */
  billingCycleEnd?: string;
  /** When true, disable plan buttons and show updating state */
  isChangingPlan?: boolean;
  /** When set, only this tier's button shows "Updating plan…"; others show normal label */
  changingToTierId?: TierKey | null;
}

function PlanModalContent({
  currentPlan,
  onAction,
  showTitle = true,
  isChangingPlan = false,
  changingToTierId = null,
}: {
  currentPlan: string;
  onAction: (tierId: TierKey) => void;
  showTitle?: boolean;
  isChangingPlan?: boolean;
  changingToTierId?: TierKey | null;
}) {
  const currencyContext = useCurrencyOptional();
  const currency = currencyContext?.currency ?? getLocaleCurrency();
  const setCurrency = currencyContext?.setCurrency;
  return (
    <>
      {showTitle && (
        <>
          <h2 className="text-2xl font-normal text-gray-900 text-center mt-20 mb-4">
            Upgrade your plan
          </h2>
          {setCurrency && (
            <div className="flex justify-center mb-20">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <span>Currency</span>
                <CurrencyDropdown value={currency} onValueChange={setCurrency} />
              </label>
            </div>
          )}
        </>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 mt-10 items-start">
        {TIER_ORDER.map((tierId) => {
          const tier = TIERS[tierId];
          const isCurrent = currentPlan === tierId;
          const isBusiness = tierId === "business";
          const priceFormatted = formatPrice(getPriceForTier(tierId, currency), currency);
          const features = getFeaturesForTier(tierId, currency);

          return (
            <div
              key={tierId}
              className="rounded-xl border border-gray-200 !bg-white p-6 md:p-8 flex flex-col shadow-sm"
            >
              <div className="min-h-[180px] flex flex-col">
                <div>
                  <h3 className="text-3xl font-medium text-gray-900">
                    {tier.name}
                  </h3>
                  <p className="mt-8 text-2xl font-normal text-gray-900">
                    {priceFormatted}
                    <span className="text-sm font-normal text-gray-500">
                      {" "}
                      / month
                    </span>
                  </p>
                </div>
                <p className="text-sm font-normal text-gray-600 mt-5">
                  {SLOGANS[tierId]}
                </p>
              </div>

              <div className="pt-1 pb-1">
                  {isCurrent ? (
                    <div
                      className="flex items-center justify-center w-full h-10 px-4 py-2 text-sm font-normal text-gray-600 rounded-full border border-gray-200 bg-white mb-8"
                      aria-current="true"
                    >
                      Your current plan
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={isChangingPlan}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onAction(tierId);
                      }}
                      className={
                        isBusiness
                          ? "flex items-center justify-center h-10 w-full min-h-[2.5rem] px-4 py-2 text-sm font-medium rounded-full bg-gray-900 text-white hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-0 transition-colors disabled:pointer-events-none disabled:opacity-50 mb-8"
                          : "flex items-center justify-center h-10 w-full px-4 py-2 text-sm font-medium rounded-full border border-gray-200 bg-white text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-0 transition-colors disabled:pointer-events-none disabled:opacity-50 mb-8"
                      }
                    >
                      {isChangingPlan && changingToTierId === tierId ? "Updating plan…" : isBusiness ? "Upgrade to Business" : `Switch to ${tier.name}`}
                    </button>
                  )}

                  <ul className="space-y-3 mt-4">
                    {features.map((feature, i) => (
                      <li
                        key={i}
                        className="text-xs font-normal text-gray-600 flex items-start gap-2"
                      >
                        <FeatureIcon tierId={tierId} index={i} />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-2 mt-8 text-center text-sm text-gray-500">
        <img
          src="/velora-dash-logo.png"
          alt="Velora"
          className="h-7 w-auto"
        />
        <span>Need more capabilities for your business?</span>
        <a
          href="#"
          className="text-gray-700 underline hover:opacity-80"
          onClick={(e) => e.preventDefault()}
        >
          See Velora Enterprise
        </a>
      </div>
    </>
  );
}

export const PlanSelectionModal: React.FC<PlanSelectionModalProps> = ({
  open,
  onOpenChange,
  currentPlan,
  fullscreen = false,
  onUpgrade,
  onSwitch,
  billingCycleEnd,
  isChangingPlan = false,
  changingToTierId = null,
}) => {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmPendingTierId, setConfirmPendingTierId] = React.useState<TierKey | null>(null);

  const normalizedPlan = React.useMemo(() => normalizePlan(currentPlan), [currentPlan]);
  const currencyContext = useCurrencyOptional();
  const currency = currencyContext?.currency ?? getLocaleCurrency();

  const performSwitch = React.useCallback(
    (tierId: TierKey) => {
      if (tierId === normalizedPlan) return;
      const isUpgrade =
        TIER_ORDER.indexOf(tierId) > TIER_ORDER.indexOf(normalizedPlan);
      if (isUpgrade && onUpgrade) {
        onUpgrade(tierId);
      } else if (!isUpgrade && onSwitch) {
        onSwitch(tierId);
      } else if (onUpgrade) {
        onUpgrade(tierId);
      } else if (onSwitch) {
        onSwitch(tierId);
      }
      // Parent closes modal on success; stay open to show "Updating plan…" until then
    },
    [normalizedPlan, onUpgrade, onSwitch]
  );

  const handleAction = React.useCallback(
    (tierId: TierKey) => {
      if (tierId === normalizedPlan) return;
      const isDowngrade =
        TIER_ORDER.indexOf(tierId) < TIER_ORDER.indexOf(normalizedPlan);
      if (isDowngrade) {
        setConfirmPendingTierId(tierId);
        setConfirmOpen(true);
      } else {
        performSwitch(tierId);
      }
    },
    [normalizedPlan, performSwitch]
  );

  const handleConfirmDowngrade = React.useCallback(() => {
    const tierToApply = confirmPendingTierId;
    setConfirmOpen(false);
    setConfirmPendingTierId(null);
    if (tierToApply && onSwitch) {
      onSwitch(tierToApply);
    }
  }, [confirmPendingTierId, onSwitch]);

  const formattedBillingDate = formatBillingCycleEnd(billingCycleEnd);
  const dateFallback = formattedBillingDate ?? "your next billing cycle";
  const currentPlanName = TIERS[normalizedPlan]?.name ?? normalizedPlan ?? "plan";
  const newPlanName = confirmPendingTierId
    ? (TIERS[confirmPendingTierId]?.name ?? confirmPendingTierId)
    : "your new plan";
  const confirmMessage = {
    intro: "Your current",
    plan: currentPlanName,
    until: "plan stays active until",
    date: dateFallback,
    then: ". On that date it will change to",
    newPlan: newPlanName,
    end: ".",
  };
  const billingDateText = `Billing will start on ${dateFallback}`;
  const confirmPriceFormatted =
    confirmPendingTierId != null
      ? `${currency} ${formatPrice(getPriceForTier(confirmPendingTierId, currency), currency)}/month`
      : "";

  const contentProps = {
    currentPlan: normalizedPlan,
    onAction: handleAction,
    isChangingPlan,
    changingToTierId,
  };

  if (fullscreen) {
    if (!open) return null;
    return (
      <>
        <div className="fixed inset-0 z-[100] bg-[#F9F9F9] overflow-y-auto">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="fixed right-6 top-6 z-10 flex h-10 w-10 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            aria-label="Close"
          >
            <span className="text-2xl font-extralight leading-none">×</span>
          </button>
          <div className="max-w-6xl mx-auto py-12 px-6">
            <PlanModalContent {...contentProps} showTitle />
          </div>
          {/* Inline confirm (z above fullscreen) so it’s visible; AlertDialog is z-50 and was hidden behind z-[100] */}
          {confirmOpen && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/20 backdrop-blur-[2px] p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-plan-title">
              <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full p-6" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between">
                  <h2 id="confirm-plan-title" className="text-base font-medium text-gray-900">Confirm plan changes</h2>
                  <button
                    type="button"
                    onClick={() => { setConfirmOpen(false); setConfirmPendingTierId(null); }}
                    className="flex h-8 w-8 items-center justify-center rounded text-gray-600 hover:bg-gray-100 transition-colors"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-4 text-sm text-gray-700">
                  {confirmMessage.intro} <span className="font-medium">{confirmMessage.plan}</span> {confirmMessage.until} <span className="font-medium">{confirmMessage.date}</span>{confirmMessage.then} <span className="font-medium">{confirmMessage.newPlan}</span>{confirmMessage.end}
                </p>
                {confirmPendingTierId != null && (
                  <div className="mt-5 mb-5 rounded-lg bg-gray-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-900 text-base">{newPlanName}</p>
                        <p className="mt-1 text-sm text-gray-500">{billingDateText}</p>
                      </div>
                      {confirmPriceFormatted && (
                        <p className="text-base text-gray-900 whitespace-nowrap">{confirmPriceFormatted}</p>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    type="button"
                    onClick={() => { setConfirmOpen(false); setConfirmPendingTierId(null); }}
                    className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-full hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleConfirmDowngrade();
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-full hover:bg-gray-800"
                  >
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-6xl w-[95vw] bg-background border border-gray-200 p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 text-center">
              <DialogTitle className="text-2xl font-normal text-gray-900">
                Upgrade your plan
              </DialogTitle>
              {currencyContext?.setCurrency && (
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <span>Currency</span>
                  <CurrencyDropdown
                    value={currencyContext.currency}
                    onValueChange={currencyContext.setCurrency}
                  />
                </label>
              )}
            </div>
          </DialogHeader>
          <div className="px-6 pb-6">
            <PlanModalContent {...contentProps} showTitle={false} />
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-medium">Confirm plan changes</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="text-sm text-gray-700">
                  {confirmMessage.intro} <span className="font-medium">{confirmMessage.plan}</span> {confirmMessage.until} <span className="font-medium">{confirmMessage.date}</span>{confirmMessage.then} <span className="font-medium">{confirmMessage.newPlan}</span>{confirmMessage.end}
                </p>
                {confirmPendingTierId != null && (
                  <div className="mt-5 mb-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-900 text-base">{newPlanName}</p>
                        <p className="mt-1 text-sm text-gray-500">{billingDateText}</p>
                      </div>
                      {confirmPriceFormatted && (
                        <p className="text-base text-gray-900 whitespace-nowrap">{confirmPriceFormatted}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setConfirmPendingTierId(null)}
              className="px-3 py-1.5 text-xs font-medium rounded-full bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleConfirmDowngrade();
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-full bg-gray-900 text-white hover:bg-gray-800"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
