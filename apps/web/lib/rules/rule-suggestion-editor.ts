import { create } from "zustand";

import type { RuleSuggestion } from "@/lib/api/rule/useRuleSuggestions";

/**
 * The rule suggestion the person chose to turn into a rule. The prompt (a
 * toast) can outlive the screen that showed it, so the editor it opens lives
 * in the app shell (`RuleSuggestionEditorHost`) and is driven from here.
 */
interface RuleSuggestionEditorState {
  suggestion: RuleSuggestion | null;
  open: (suggestion: RuleSuggestion) => void;
  close: () => void;
}

export const useRuleSuggestionEditor = create<RuleSuggestionEditorState>(
  (set) => ({
    suggestion: null,
    open: (suggestion) => set({ suggestion }),
    close: () => set({ suggestion: null }),
  }),
);
