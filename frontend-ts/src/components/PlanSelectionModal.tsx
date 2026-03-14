"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { backendApi } from "@/services/backendApi";
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
import { StackedModelIcons } from "./StackedModelIcons";

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
        className={`flex h-6 w-full items-center justify-between border border-gray-200 pl-3 pr-0.5 gap-0.5 text-xs text-gray-900 focus:ring-1 focus:ring-gray-300 focus:ring-offset-0 ${
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
              className="flex cursor-default items-center pl-3 pr-1.5 py-0.5 first:pt-0.5 last:pb-0.5 hover:bg-gray-50 text-gray-900"
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
  business: "Maximum power for your documents.",
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
    "Choose your AI model – optimise for speed, depth, or cost",
    "More cloud storage for documents and history",
    "Priority processing",
    "Extended semantic search and chat across your full document set",
    "For freelancers, consultants, and solo professionals",
  ],
  business: [
    "5,000 pages per month",
    "Choose your AI model – optimise for speed, depth, or cost",
    "Largest cloud storage for documents and history",
    "Flexible allowance – use it where it matters",
    "Dedicated support agent",
    "2× faster processing speeds",
    "Extend your page limit",
  ],
};

/** Icons for each feature (same order as FEATURES_BASE). Same concept = same icon across tiers. */
const FEATURE_ICONS: Record<TierKey, LucideIcon[]> = {
  personal: [BookOpen, Sparkles, MessageSquare, Search, Receipt],
  professional: [BookOpen, Cpu, Cloud, Zap, Search, Briefcase],
  business: [BookOpen, Cpu, Cloud, Users, Headphones, Zap, CreditCard],
};

function getFeaturesForTier(tierId: TierKey, _currency: string): string[] {
  return FEATURES_BASE[tierId];
}

/** Button that opens the Enterprise contact form (email to connect@solosway.co). */
function EnterpriseContactLink() {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!name.trim()) {
      setSubmitError("Name is required");
      return;
    }
    if (!email.trim()) {
      setSubmitError("Email is required");
      return;
    }
    setSubmitting(true);
    const res = await backendApi.submitEnterpriseInquiry({
      name: name.trim(),
      email: email.trim(),
      company: company.trim() || undefined,
      message: message.trim() || undefined,
    });
    setSubmitting(false);
    if (res.success) {
      setSubmitted(true);
      setTimeout(() => {
        setOpen(false);
        setSubmitted(false);
        setName("");
        setEmail("");
        setCompany("");
        setMessage("");
      }, 1500);
    } else {
      setSubmitError(res.error || "Failed to send. Please try again.");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-gray-700 underline hover:opacity-80 cursor-pointer bg-transparent border-none p-0 font-inherit"
      >
        See OpenFind Enterprise
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-md bg-background border border-gray-200 p-0 gap-0 !z-[120]"
          overlayClassName="!z-[120]"
        >
          <DialogHeader className="p-6 pb-4">
            <DialogTitle className="text-lg font-medium text-gray-900">
              Contact us about OpenFind Enterprise
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
            <div>
              <label htmlFor="enterprise-name" className="block text-sm font-medium text-gray-700 mb-1">
                Name *
              </label>
              <input
                id="enterprise-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400"
                placeholder="Your name"
                disabled={submitting || submitted}
              />
            </div>
            <div>
              <label htmlFor="enterprise-email" className="block text-sm font-medium text-gray-700 mb-1">
                Email *
              </label>
              <input
                id="enterprise-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400"
                placeholder="you@company.com"
                disabled={submitting || submitted}
              />
            </div>
            <div>
              <label htmlFor="enterprise-company" className="block text-sm font-medium text-gray-700 mb-1">
                Company
              </label>
              <input
                id="enterprise-company"
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400"
                placeholder="Your company"
                disabled={submitting || submitted}
              />
            </div>
            <div>
              <label htmlFor="enterprise-message" className="block text-sm font-medium text-gray-700 mb-1">
                Message
              </label>
              <textarea
                id="enterprise-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 resize-none"
                placeholder="Tell us about your enterprise needs..."
                disabled={submitting || submitted}
              />
            </div>
            {submitError && (
              <p className="text-sm text-red-600">{submitError}</p>
            )}
            {submitted && (
              <p className="text-sm text-green-600">Thank you! We&apos;ll be in touch soon.</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-full hover:bg-gray-50"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || submitted}
                className="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-full hover:bg-gray-800 disabled:opacity-50"
              >
                {submitting ? "Sending…" : submitted ? "Sent!" : "Send"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

const iconClassName = "h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-500";

/** Renders the feature icon for a tier and index so Lucide Icon always receives a valid component.
 * For model-selection features (Cpu icon), shows stacked model icons (OpenAI, Gemini, Claude) like the
 * file icons in SearchingSourcesCarousel. */
function FeatureIcon({ tierId, index }: { tierId: TierKey; index: number }) {
  const Icon = FEATURE_ICONS[tierId]?.[index];
  if (!Icon) return <span className={iconClassName} aria-hidden />;
  if (Icon === Cpu)
    return (
      <span className="mt-0.5 shrink-0 flex items-center">
        <StackedModelIcons />
      </span>
    );
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
  /** When set, skip tier selection and open directly to the confirm dialog for this tier (used by DashboardUpgradeCta) */
  openDirectlyToTier?: TierKey | null;
  /** Called when openDirectlyToTier has been consumed */
  onConsumedDirectTier?: () => void;
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
                          ? "flex items-center justify-center h-10 w-full min-h-[2.5rem] px-4 py-2 text-sm font-medium rounded-full bg-gray-900 text-white hover:bg-[#2d2d2b] hover:shadow-md hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-0 transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 mb-8"
                          : "flex items-center justify-center h-10 w-full px-4 py-2 text-sm font-medium rounded-full border border-gray-200 bg-white text-gray-900 hover:bg-[#FAFAF9] hover:border-[#E5E5E2] hover:shadow-md hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-0 transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 mb-8"
                      }
                    >
                      {isChangingPlan && changingToTierId === tierId ? "Updating plan…" : isBusiness ? "Upgrade to Ultra" : `Switch to ${tier.name}`}
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
          src="/OpenFind(1).png"
          alt="OpenFind"
          className="h-6 object-contain object-left"
          style={{ width: 'auto', maxWidth: '240px' }}
        />
        <span>Need more capabilities for your business?</span>
        <EnterpriseContactLink />
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
  openDirectlyToTier = null,
  onConsumedDirectTier,
}) => {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmPendingTierId, setConfirmPendingTierId] = React.useState<TierKey | null>(null);

  const normalizedPlan = React.useMemo(() => normalizePlan(currentPlan), [currentPlan]);

  // When openDirectlyToTier is set, skip tier selection and open directly to the confirm step
  React.useEffect(() => {
    if (open && openDirectlyToTier && openDirectlyToTier !== normalizedPlan) {
      setConfirmPendingTierId(openDirectlyToTier);
      setConfirmOpen(true);
      onConsumedDirectTier?.();
    }
  }, [open, openDirectlyToTier, normalizedPlan, onConsumedDirectTier]);
  const currencyContext = useCurrencyOptional();
  const currency = currencyContext?.currency ?? getLocaleCurrency();

  const handleAction = React.useCallback(
    (tierId: TierKey) => {
      if (tierId === normalizedPlan) return;
      setConfirmPendingTierId(tierId);
      setConfirmOpen(true);
    },
    [normalizedPlan]
  );

  const handleConfirmPlanChange = React.useCallback(() => {
    const tierToApply = confirmPendingTierId;
    setConfirmOpen(false);
    setConfirmPendingTierId(null);
    if (!tierToApply) return;
    const isUpgrade =
      TIER_ORDER.indexOf(tierToApply) > TIER_ORDER.indexOf(normalizedPlan);
    if (isUpgrade && onUpgrade) {
      onUpgrade(tierToApply);
    } else if (!isUpgrade && onSwitch) {
      onSwitch(tierToApply);
    } else if (onUpgrade) {
      onUpgrade(tierToApply);
    } else if (onSwitch) {
      onSwitch(tierToApply);
    }
  }, [confirmPendingTierId, normalizedPlan, onUpgrade, onSwitch]);

  const formattedBillingDate = formatBillingCycleEnd(billingCycleEnd);
  const dateFallback = formattedBillingDate ?? "your next billing cycle";
  const currentPlanName = TIERS[normalizedPlan]?.name ?? normalizedPlan ?? "plan";
  const newPlanName = confirmPendingTierId
    ? (TIERS[confirmPendingTierId]?.name ?? confirmPendingTierId)
    : "your new plan";
  const isConfirmDowngrade =
    confirmPendingTierId != null &&
    TIER_ORDER.indexOf(confirmPendingTierId) < TIER_ORDER.indexOf(normalizedPlan);
  const confirmMessage = isConfirmDowngrade
    ? {
        intro: "Your current",
        plan: currentPlanName,
        until: "plan stays active until",
        date: dateFallback,
        then: ". On that date it will change to",
        newPlan: newPlanName,
        end: ".",
      }
    : {
        intro: "You're about to switch to",
        plan: newPlanName + ".",
        until: "",
        date: "",
        then: "",
        newPlan: "",
        end: dateFallback ? ` Billing will apply from ${dateFallback}.` : "",
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
            className="fixed right-6 top-6 z-10 flex h-10 w-10 items-center justify-center rounded-md text-gray-500"
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
                      handleConfirmPlanChange();
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
          <DialogHeader className="p-6 pb-4 text-center sm:text-center">
            <div className="flex flex-col items-center justify-center gap-3 w-full">
              <DialogTitle className="text-2xl font-normal text-gray-900">
                Upgrade your plan
              </DialogTitle>
              {currencyContext?.setCurrency && (
                <label className="flex items-center justify-center gap-2 text-sm text-gray-600">
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
                handleConfirmPlanChange();
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
