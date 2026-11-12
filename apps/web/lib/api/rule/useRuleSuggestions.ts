import { useMutation } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { RuleAction, RuleCondition, RuleMatch } from "./useRules";

/**
 * A rule the API offers after the member's own repeated recategorization:
 * `ruleSuggestion` on the `PATCH /v1/account/transaction` responses (single
 * and bulk), null when there is none.
 */
export interface RuleSuggestion {
  category: { categoryKey: number; name: string };
  /** Names the suggestion for "Don't suggest again". */
  fingerprint: string;
  kind: "description" | "merchant";
  /** Transactions moved this way within `windowDays`, this change included. */
  matchCount: number;
  rule: {
    name: string;
    match: RuleMatch;
    stopProcessing: boolean;
    conditions: RuleCondition[];
    actions: RuleAction[];
  };
  windowDays: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * The suggestion in an update response body, or null. An older API answers
 * the bulk update with no body at all, and a malformed one is no offer.
 */
export function readRuleSuggestion(body: unknown): RuleSuggestion | null {
  if (!isRecord(body) || !isRecord(body.ruleSuggestion)) return null;
  const suggestion = body.ruleSuggestion;
  const { category, rule } = suggestion;
  if (
    typeof suggestion.fingerprint !== "string" ||
    typeof suggestion.matchCount !== "number" ||
    typeof suggestion.windowDays !== "number" ||
    !isRecord(category) ||
    typeof category.categoryKey !== "number" ||
    typeof category.name !== "string" ||
    !isRecord(rule) ||
    typeof rule.name !== "string" ||
    !Array.isArray(rule.conditions) ||
    !Array.isArray(rule.actions)
  ) {
    return null;
  }
  return suggestion as unknown as RuleSuggestion;
}

/** Never offer this suggestion to the current member again. */
export async function dismissRuleSuggestion(
  fingerprint: string,
  apiClient: AxiosInstance = api,
): Promise<void> {
  await apiClient.post("/v1/rule/suggestions/dismiss", { fingerprint });
}

export function useDismissRuleSuggestion() {
  return useMutation({
    mutationFn: (fingerprint: string) => dismissRuleSuggestion(fingerprint),
  });
}
