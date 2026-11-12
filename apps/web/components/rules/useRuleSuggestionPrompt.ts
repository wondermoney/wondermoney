"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";

import {
  readRuleSuggestion,
  useDismissRuleSuggestion,
} from "@/lib/api/rule/useRuleSuggestions";
import { useRuleSuggestionEditor } from "@/lib/rules/rule-suggestion-editor";
import { getCategoryDisplayName } from "@/lib/utils/categories";

/** Long enough to read and decide; the offer comes back the next time anyway. */
const PROMPT_DURATION_MS = 15_000;

/**
 * After a category change: when the update response carries a rule
 * suggestion, ask "Always categorize transactions like this as Groceries?".
 * **Create rule** opens the rule editor filled in, with its preview;
 * **Don't suggest again** dismisses the suggestion for good. Pass the
 * response body; one without a suggestion shows nothing.
 */
export function useRuleSuggestionPrompt() {
  const t = useTranslations();
  const openEditor = useRuleSuggestionEditor((state) => state.open);
  const { mutate: dismiss } = useDismissRuleSuggestion();

  return useCallback(
    (body: unknown) => {
      const suggestion = readRuleSuggestion(body);
      if (!suggestion) return;
      toast(
        t("rules.suggestion.title", {
          category: getCategoryDisplayName(t, suggestion.category.name),
        }),
        {
          id: `rule-suggestion-${suggestion.fingerprint}`,
          description: t("rules.suggestion.description", {
            count: suggestion.matchCount,
            days: suggestion.windowDays,
          }),
          duration: PROMPT_DURATION_MS,
          action: {
            label: t("rules.suggestion.create"),
            onClick: () => openEditor(suggestion),
          },
          cancel: {
            label: t("rules.suggestion.dismiss"),
            onClick: () =>
              dismiss(suggestion.fingerprint, {
                onError: () => toast.error(t("rules.suggestion.dismiss-error")),
              }),
          },
        },
      );
    },
    [dismiss, openEditor, t],
  );
}
