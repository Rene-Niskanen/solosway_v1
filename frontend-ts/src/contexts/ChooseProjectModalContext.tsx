"use client";

import * as React from "react";

export type AnchorRect = { left: number; top: number; width: number; height: number };

interface ChooseProjectModalContextType {
  openChooseProjectModal: (anchorRect?: AnchorRect | null) => void;
}

const ChooseProjectModalContext = React.createContext<ChooseProjectModalContextType | null>(null);

export function ChooseProjectModalProvider({
  children,
  onOpen,
}: {
  children: React.ReactNode;
  onOpen: (anchorRect?: AnchorRect | null) => void;
}) {
  const value = React.useMemo(
    () => ({
      openChooseProjectModal: onOpen,
    }),
    [onOpen]
  );
  return (
    <ChooseProjectModalContext.Provider value={value}>
      {children}
    </ChooseProjectModalContext.Provider>
  );
}

export function useChooseProjectModal(): ChooseProjectModalContextType {
  const ctx = React.useContext(ChooseProjectModalContext);
  if (!ctx) {
    return {
      openChooseProjectModal: (anchorRect?: AnchorRect | null) => {
        window.dispatchEvent(
          new CustomEvent("openChooseProjectModal", {
            detail: anchorRect ? { anchorRect } : undefined,
          })
        );
      },
    };
  }
  return ctx;
}
