"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";

import {
  readPrivacyMode,
  subscribePrivacyMode,
  writePrivacyMode,
} from "./privacy-mode-store";

/**
 * What the server read from the cookie. `useSyncExternalStore` renders this
 * during SSR and hydration, so the first paint matches the stored choice and
 * hydration does not disagree with the server's HTML.
 */
const ServerPrivacyModeContext = createContext(false);

export function PrivacyModeProvider({
  initialHidden,
  children,
}: {
  initialHidden: boolean;
  children: ReactNode;
}) {
  return (
    <ServerPrivacyModeContext.Provider value={initialHidden}>
      {children}
    </ServerPrivacyModeContext.Provider>
  );
}

export type PrivacyMode = {
  /** True when amounts must not be shown. */
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
  toggle: () => void;
};

/**
 * Privacy mode: whether money figures are masked on this device.
 *
 * Components rarely need this directly. `<Amount>`, `useFormatCurrency()` and
 * the chart formatters already consult it; reach for it only to build a
 * toggle or to hide something that is not a formatted figure.
 */
export function usePrivacyMode(): PrivacyMode {
  const serverHidden = useContext(ServerPrivacyModeContext);
  const hidden = useSyncExternalStore(
    subscribePrivacyMode,
    readPrivacyMode,
    () => serverHidden,
  );

  const setHidden = useCallback((next: boolean) => writePrivacyMode(next), []);
  const toggle = useCallback(() => writePrivacyMode(!readPrivacyMode()), []);

  return { hidden, setHidden, toggle };
}

/** Typing a capital P in a field must type it, not flip privacy mode. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function isPrivacyShortcut(event: KeyboardEvent): boolean {
  return (
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.repeat &&
    event.code === "KeyP" &&
    !isEditableTarget(event.target)
  );
}

/** Shift+P toggles privacy mode anywhere outside a text field. */
export function usePrivacyModeShortcut(onToggle?: (hidden: boolean) => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPrivacyShortcut(event)) return;
      event.preventDefault();
      const next = !readPrivacyMode();
      writePrivacyMode(next);
      onToggle?.(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onToggle]);
}
