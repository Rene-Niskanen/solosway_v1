"use client";

import * as React from "react";
import type {
  SavedCitationContext,
  CitationExportData,
} from "../utils/citationExport";

export type CitationSaveActionHandlers = {
  onChoose: () => void;
  onCopy: () => void;
  onCancel: () => void;
} | null;

type CitationExportContextValue = {
  savedCitationContext: SavedCitationContext | null;
  setSavedCitationContext: (v: SavedCitationContext | null) => void;
  screenshotModeActive: boolean;
  setScreenshotModeActive: (v: boolean) => void;
  citationExportData: CitationExportData;
  setCitationExportData: React.Dispatch<React.SetStateAction<CitationExportData>>;
  onChooseCapture: (dataUrl: string) => void;
  onChooseCancel: () => void;
  /** Handlers for Save bar (Choose/Copy/Cancel), set by SideChatPanel so doc view can show bar next to citation */
  saveActionHandlers: CitationSaveActionHandlers;
  setSaveActionHandlers: (v: CitationSaveActionHandlers) => void;
};

const CitationExportContext = React.createContext<CitationExportContextValue | null>(null);

export function useCitationExport(): CitationExportContextValue {
  const ctx = React.useContext(CitationExportContext);
  if (!ctx) {
    throw new Error("useCitationExport must be used within CitationExportProvider");
  }
  return ctx;
}

export function useCitationExportOptional(): CitationExportContextValue | null {
  return React.useContext(CitationExportContext);
}

export const CitationExportProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [savedCitationContext, setSavedCitationContext] = React.useState<SavedCitationContext | null>(null);
  const [screenshotModeActive, setScreenshotModeActive] = React.useState(false);
  const [citationExportData, setCitationExportData] = React.useState<CitationExportData>({});
  const [saveActionHandlers, setSaveActionHandlers] = React.useState<CitationSaveActionHandlers>(null);

  const onChooseCapture = React.useCallback((dataUrl: string) => {
    setSavedCitationContext((ctx) => {
      if (!ctx) {
        setScreenshotModeActive(false);
        return null;
      }
      setCitationExportData((prev) => ({
        ...prev,
        [ctx.messageId]: {
          ...(prev[ctx.messageId] ?? {}),
          [ctx.citationNumber]: { type: "choose", imageDataUrl: dataUrl },
        },
      }));
      setScreenshotModeActive(false);
      return null;
    });
  }, []);

  const onChooseCancel = React.useCallback(() => {
    setScreenshotModeActive(false);
    setSavedCitationContext(null);
  }, []);

  const value: CitationExportContextValue = React.useMemo(
    () => ({
      savedCitationContext,
      setSavedCitationContext,
      screenshotModeActive,
      setScreenshotModeActive,
      citationExportData,
      setCitationExportData,
      onChooseCapture,
      onChooseCancel,
      saveActionHandlers,
      setSaveActionHandlers,
    }),
    [
      savedCitationContext,
      screenshotModeActive,
      citationExportData,
      onChooseCapture,
      onChooseCancel,
      saveActionHandlers,
    ]
  );

  return (
    <CitationExportContext.Provider value={value}>
      {children}
    </CitationExportContext.Provider>
  );
};
