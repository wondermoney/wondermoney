"use client";

import { useSyncExternalStore } from "react";

/**
 * The assistant panel's open state and the question it was asked to pre-fill,
 * kept outside React so any surface can open it without prop drilling — the
 * launcher, and the "Ask the assistant" link on an insight. The same pattern as
 * the command palette and privacy-mode stores: a module singleton read through
 * `useSyncExternalStore`.
 *
 * A prompt is only ever *placed in the input*. Nothing is sent until the person
 * presses Send, and closing the panel clears it.
 */

let open = false;
let prompt: null | string = null;
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

/**
 * Open the panel, optionally with a question already in the input. An empty or
 * blank prompt opens the panel empty, like the launcher does.
 */
export function openAssistant({
  prompt: nextPrompt,
}: { prompt?: string } = {}): void {
  const trimmed = nextPrompt?.trim();
  prompt = trimmed ? trimmed : null;
  open = true;
  emit();
}

export function closeAssistant(): void {
  prompt = null;
  if (open) {
    open = false;
    emit();
  }
}

/** Drop the pre-filled question once the chat has taken it. */
export function clearAssistantPrompt(): void {
  if (prompt === null) return;
  prompt = null;
  emit();
}

/** True while the panel is open. False during SSR and the first render. */
export function useAssistantOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}

/** The question to pre-fill, or null. Null during SSR and the first render. */
export function useAssistantPrompt(): null | string {
  return useSyncExternalStore(
    subscribe,
    () => prompt,
    () => null,
  );
}
