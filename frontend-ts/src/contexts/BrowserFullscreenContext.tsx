"use client";

import * as React from "react";

interface BrowserFullscreenContextType {
  isBrowserFullscreen: boolean;
  toggleBrowserFullscreen: () => Promise<void>;
}

const BrowserFullscreenContext = React.createContext<BrowserFullscreenContextType | null>(null);

export function BrowserFullscreenProvider({ children }: { children: React.ReactNode }) {
  const [isBrowserFullscreen, setIsBrowserFullscreen] = React.useState<boolean>(
    typeof document !== "undefined" && !!document.fullscreenElement
  );

  React.useEffect(() => {
    const handleFullscreenChange = () => {
      setIsBrowserFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleBrowserFullscreen = React.useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsBrowserFullscreen(false);
      } else {
        await document.documentElement.requestFullscreen();
        setIsBrowserFullscreen(true);
      }
    } catch (err) {
      console.error("Error toggling fullscreen:", err);
      // Sync state with actual document state on error (e.g. user denied)
      setIsBrowserFullscreen(!!document.fullscreenElement);
    }
  }, []);

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
