"use client";

import { useSyncExternalStore } from "react";

/**
 * The command palette's open state, kept outside React so any shell element
 * (the TopBar search button, the sidebar footer, the person's menu, the
 * Cmd+K hotkey) can open it without prop drilling. The same pattern as the
 * privacy-mode store: a module singleton read through `useSyncExternalStore`.
 *
 * `trigger` remembers the element to hand focus back to when the palette
 * closes — the button that was clicked, or whatever had focus when the
 * hotkey fired.
 */

let open = false;
let trigger: HTMLElement | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The element focus should return to on close, if it is still on the page. */
export function getCommandPaletteTrigger(): HTMLElement | null {
  return trigger;
}

export function openCommandPalette(triggerElement?: HTMLElement | null): void {
  trigger =
    triggerElement ??
    (typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement | null));
  if (!open) {
    open = true;
    emit();
  }
}

export function closeCommandPalette(): void {
  if (open) {
    open = false;
    emit();
  }
}

export function toggleCommandPalette(
  triggerElement?: HTMLElement | null,
): void {
  if (open) closeCommandPalette();
  else openCommandPalette(triggerElement);
}

/** True while the palette is open. False during SSR and the first render. */
export function useCommandPaletteOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}
