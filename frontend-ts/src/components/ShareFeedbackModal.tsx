"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { backendApi } from "@/services/backendApi";
import { toast } from "@/hooks/use-toast";

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
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

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
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
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
