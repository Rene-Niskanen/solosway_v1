"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { backendApi } from "@/services/backendApi";
import { toast } from "@/hooks/use-toast";
import { useFeedbackModal } from "@/contexts/FeedbackModalContext";
import html2canvas from "html2canvas";
import { Camera, X } from "lucide-react";

const SCREENSHOT_DELAY_MS = 900;
const SCREENSHOT_MAX_BASE64_BYTES = 3 * 1024 * 1024; // 3 MB

const FEEDBACK_CATEGORIES = [
  "Incorrect or incomplete",
  "Not what I asked for",
  "Slow or buggy",
  "Style or tone",
  "Safety or legal concern",
  "Other",
] as const;

export interface ShareFeedbackModalProps {
  open: boolean;
  onClose: () => void;
  messageId: string | null;
  conversationSnippet: string;
  onSubmitSuccess?: () => void;
}

export const ShareFeedbackModal: React.FC<ShareFeedbackModalProps> = ({
  open,
  onClose,
  messageId,
  conversationSnippet,
  onSubmitSuccess,
}) => {
  const { feedbackScreenshot, setFeedbackScreenshot } = useFeedbackModal();
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isHiddenForScreenshot, setIsHiddenForScreenshot] = React.useState(false);
  const [isCapturing, setIsCapturing] = React.useState(false);

  const resetForm = React.useCallback(() => {
    setSelectedCategory(null);
    setDetails("");
  }, []);

  const handleClose = React.useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  React.useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

  const takeScreenshot = React.useCallback(() => {
    setIsHiddenForScreenshot(true);
    setIsCapturing(true);
    toast({ title: "Taking screenshot…", description: "The feedback window will reappear in a moment." });
  }, []);

  React.useEffect(() => {
    if (!isHiddenForScreenshot || !isCapturing) return;
    const timer = setTimeout(async () => {
      try {
        const root = document.getElementById("root") ?? document.body;
        const canvas = await html2canvas(root, {
          useCORS: true,
          allowTaint: true,
          scale: window.devicePixelRatio ?? 1,
          logging: false,
        });
        const dataUrl = canvas.toDataURL("image/png");
        setFeedbackScreenshot(dataUrl);
      } catch (err) {
        toast({
          title: "Screenshot failed",
          description: err instanceof Error ? err.message : "Could not capture the screen.",
          variant: "destructive",
        });
      } finally {
        setIsHiddenForScreenshot(false);
        setIsCapturing(false);
      }
    }, SCREENSHOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isHiddenForScreenshot, isCapturing, setFeedbackScreenshot]);

  /** Extract base64 from data URL and optionally enforce size limit (backend will also enforce). */
  const getScreenshotBase64 = React.useCallback((): string | undefined => {
    if (!feedbackScreenshot) return undefined;
    const base64 = feedbackScreenshot.replace(/^data:image\/\w+;base64,/, "");
    const bytes = Math.ceil((base64.length * 3) / 4);
    if (bytes > SCREENSHOT_MAX_BASE64_BYTES) return undefined; // skip if over limit; backend will not receive
    return base64;
  }, [feedbackScreenshot]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCategory) return;
    setIsSubmitting(true);
    try {
      const result = await backendApi.submitChatFeedback({
        category: selectedCategory,
        details: details.trim() || undefined,
        messageId: messageId || undefined,
        conversationSnippet: conversationSnippet.slice(-2000) || undefined,
        screenshotBase64: getScreenshotBase64(),
      });
      if (result.success) {
        toast({ title: "Feedback sent", description: "Thank you for helping us improve." });
        handleClose();
        onSubmitSuccess?.();
      } else {
        toast({ title: "Failed to send feedback", description: result.error || "Please try again.", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to send feedback.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open && !isHiddenForScreenshot} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent
        overlayClassName="z-[10002]"
        className="z-[10002] max-w-md p-0 overflow-hidden bg-[#1f1f1f] border-0 text-white"
      >
        <div className="p-6">
          <DialogHeader>
            <DialogTitle className="text-center text-lg font-semibold text-white">
              Share feedback
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <p className="text-sm text-gray-300 mb-2">What went wrong? <span className="text-gray-500">(required)</span></p>
              <div className="grid grid-cols-1 gap-2">
                {FEEDBACK_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className="text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-75 text-white hover:bg-[#353535] active:bg-[#3d3d3d] border"
                    style={{
                      backgroundColor: selectedCategory === cat ? "#353535" : "#2a2a2a",
                      borderColor: selectedCategory === cat ? "#6b7280" : "transparent",
                    }}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="feedback-details" className="text-sm text-gray-300 block mb-1">
                Share details (optional)
              </label>
              <textarea
                id="feedback-details"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Add more context..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-[#2a2a2a] border border-transparent text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 text-sm"
              />
            </div>
            <div>
              <p className="text-sm text-gray-300 mb-2">Screenshot (optional)</p>
              {feedbackScreenshot ? (
                <div className="flex items-start gap-2 p-2 rounded-lg bg-[#2a2a2a] border border-transparent">
                  <img
                    src={feedbackScreenshot}
                    alt="Screenshot"
                    className="max-h-24 rounded object-cover border border-[#353535]"
                  />
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={takeScreenshot}
                      disabled={isCapturing}
                      className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-[#353535] transition-colors disabled:opacity-50"
                      aria-label="Replace screenshot"
                      title="Replace screenshot"
                    >
                      <Camera className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setFeedbackScreenshot(null)}
                      className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-[#353535] transition-colors"
                      aria-label="Remove screenshot"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={takeScreenshot}
                  disabled={isCapturing}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#2a2a2a] text-gray-300 text-sm font-medium border border-transparent hover:bg-[#353535] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Camera className="h-4 w-4" />
                  {isCapturing ? "Capturing…" : "Take screenshot"}
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400">
              Your conversation will be included with your feedback to help improve our product.{" "}
              <a href="#" className="underline hover:text-gray-300" onClick={(e) => e.preventDefault()}>
                Learn more
              </a>
            </p>
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={!selectedCategory || isSubmitting}
                className="px-4 py-2 rounded-lg bg-[#2a2a2a] text-white text-sm font-medium transition-colors duration-75 hover:bg-[#353535] active:bg-[#3d3d3d] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Sending..." : "Submit"}
              </button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
};
