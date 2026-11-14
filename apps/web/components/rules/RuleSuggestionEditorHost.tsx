"use client";

import { useLocale } from "next-intl";
import { useCallback, useState } from "react";

import type { Rule } from "@/lib/api/rule/useRules";
import type { RuleSuggestion } from "@/lib/api/rule/useRuleSuggestions";
import { formFromSuggestion } from "@/lib/rules/rule-draft";
import { useRuleSuggestionEditor } from "@/lib/rules/rule-suggestion-editor";

import { ApplyRulesDialog } from "./ApplyRulesDialog";
import { RuleEditorDialog } from "./RuleEditorDialog";

function SuggestedRuleEditor({
  suggestion,
  onClose,
  onSaved,
}: {
  suggestion: RuleSuggestion;
  onClose: () => void;
  onSaved: (rule: Rule) => void;
}) {
  const locale = useLocale();
  return (
    <RuleEditorDialog
      open
      initialForm={formFromSuggestion(suggestion, locale)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSaved={onSaved}
    />
  );
}

/**
 * The rule editor a rule suggestion opens, pre-filled with the suggested rule
 * and its live preview, then the offer to apply the saved rule to existing
 * transactions. Mounted once in the app shell; renders nothing until the
 * person chooses **Create rule** on a suggestion.
 */
export function RuleSuggestionEditorHost() {
  const suggestion = useRuleSuggestionEditor((state) => state.suggestion);
  const close = useRuleSuggestionEditor((state) => state.close);
  const [applying, setApplying] = useState<Rule | null>(null);
  const closeApplying = useCallback(() => setApplying(null), []);

  return (
    <>
      {suggestion ? (
        <SuggestedRuleEditor
          key={suggestion.fingerprint}
          suggestion={suggestion}
          onClose={close}
          onSaved={(saved) => {
            if (saved.active) setApplying(saved);
          }}
        />
      ) : null}
      {applying ? (
        <ApplyRulesDialog
          key={applying.ruleKey}
          target={{ ruleKey: applying.ruleKey }}
          ruleName={applying.name}
          offer
          onClose={closeApplying}
        />
      ) : null}
    </>
  );
}
