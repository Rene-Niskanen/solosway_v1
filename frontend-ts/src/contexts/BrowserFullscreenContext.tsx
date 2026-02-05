"use client";

import * as React from "react";

interface BrowserFullscreenContextType {
  isBrowserFullscreen: boolean;
  toggleBrowserFullscreen: () => Promise<void>;
}

const BrowserFullscreenContext = React.createContext<BrowserFullscreenContextType | null>(null);

type DocWithWebkit = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};
type ElWithWebkit = Element & {
  requestFullscreen?: () => Promise<void>;
  webkitRequestFullscreen?: () => Promise<void>;
};

/** Cross-browser: get the element currently in fullscreen (standard or webkit). */
function getFullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  const d = document as DocWithWebkit;
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

/** Request fullscreen on an element (standard or webkit). */
function requestFullscreen(element: Element): Promise<void> {
  const el = element as ElWithWebkit;
  const fn = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (fn) return fn.call(el);
  return Promise.reject(new Error("Fullscreen API not supported"));
}

/** Exit fullscreen using the same vendor that's active (so exit actually works). */
function exitFullscreen(): Promise<void> {
  const d = document as DocWithWebkit;
  const hasWebkit = d.webkitFullscreenElement != null;
  if (hasWebkit && typeof d.webkitExitFullscreen === "function") {
    return d.webkitExitFullscreen.call(document);
  }
  if (typeof d.exitFullscreen === "function") {
    return d.exitFullscreen.call(document);
  }
  return Promise.reject(new Error("Exit fullscreen not supported"));
}

/** Provides fullscreen state; keyboard shortcut ⌘F to toggle is handled in MainContent. */
export function BrowserFullscreenProvider({ children }: { children: React.ReactNode }) {
  const [isBrowserFullscreen, setIsBrowserFullscreen] = React.useState<boolean>(() =>
    typeof document !== "undefined" && !!getFullscreenElement()
  );

  const syncFromDocument = React.useCallback(() => {
    setIsBrowserFullscreen(!!getFullscreenElement());
  }, []);

  // Listen for fullscreen changes (both standard and webkit)
  React.useEffect(() => {
    document.addEventListener("fullscreenchange", syncFromDocument);
    document.addEventListener("webkitfullscreenchange", syncFromDocument);
    return () => {
      document.removeEventListener("fullscreenchange", syncFromDocument);
      document.removeEventListener("webkitfullscreenchange", syncFromDocument);
    };
  }, [syncFromDocument]);

  // Sync from document on mount and when tab becomes visible (catches F11 / already fullscreen on load)
  React.useEffect(() => {
    syncFromDocument();
    const onVisibility = () => syncFromDocument();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [syncFromDocument]);

  const toggleBrowserFullscreen = React.useCallback(async () => {
    try {
      const inFullscreen = !!getFullscreenElement();
      if (inFullscreen) {
        await exitFullscreen();
        setIsBrowserFullscreen(false);
      } else {
        await requestFullscreen(document.documentElement);
        setIsBrowserFullscreen(true);
      }
    } catch (err) {
      console.error("Error toggling fullscreen:", err);
      syncFromDocument();
    }
  }, [syncFromDocument]);

  const value = React.useMemo(
    () => ({ isBrowserFullscreen, toggleBrowserFullscreen }),
    [isBrowserFullscreen, toggleBrowserFullscreen]
  );

  return (
    <BrowserFullscreenContext.Provider value={value}>
      {children}
    </BrowserFullscreenContext.Provider>
  );
}

export function useBrowserFullscreen(): BrowserFullscreenContextType {
  const ctx = React.useContext(BrowserFullscreenContext);
  if (!ctx) {
    throw new Error("useBrowserFullscreen must be used within BrowserFullscreenProvider");
  }
  return ctx;
}
