import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

/**
 * The household's automation rules, as `/v1/rule` returns and accepts them.
 * Mirrors `services/rules/rule-schema.ts` in the API.
 *
 * Text matching ignores case, accents and repeated spaces. Amounts compare
 * without their sign; a direction condition says money in or out.
 */
export type TextOperator =
  "contains" | "not_contains" | "equals" | "starts_with" | "ends_with";
export type NumberOperator = "eq" | "gt" | "gte" | "lt" | "lte";
export type ListOperator = "in" | "not_in";

/** Stands for a transaction with no category in a category condition. */
export const UNCATEGORIZED = "uncategorized";

export type RuleCondition =
  | {
      field: "description";
      operator: TextOperator;
      source: "cleaned" | "raw";
      value: string;
    }
  | { field: "merchant"; operator: TextOperator; value: string }
  | { field: "amount"; operator: NumberOperator; value: number }
  | { field: "amount"; operator: "between"; min: number; max: number }
  | { field: "direction"; operator: "is"; value: "in" | "out" }
  | { field: "account"; operator: ListOperator; values: number[] }
  | {
      field: "category";
      operator: ListOperator;
      values: (number | typeof UNCATEGORIZED)[];
    }
  | { field: "transactionType"; operator: ListOperator; values: string[] }
  | { field: "currency"; operator: ListOperator; values: string[] };

export type RuleAction =
  | { type: "set_category"; categoryId: number }
  | { type: "set_merchant"; merchantId: number }
  | { type: "set_merchant"; merchantName: string }
  | { type: "set_description"; value: string }
  | { type: "set_notes"; value: string }
  | { type: "mark_reviewed" }
  | { type: "hide" }
  | { type: "add_tags"; tagIds: number[] };

export type RuleMatch = "all" | "any";

export interface Rule {
  ruleKey: number;
  name: string;
  active: boolean;
  match: RuleMatch;
  stopProcessing: boolean;
  conditions: RuleCondition[];
  actions: RuleAction[];
  position: number;
  ownerAppuserKey: number | null;
}

/** API limits, mirrored for the editor. */
export const MAX_RULE_CONDITIONS = 20;
export const MAX_RULES_PER_HOUSEHOLD = 200;
export const RULE_NAME_MAX_LENGTH = 100;
export const RULE_TEXT_MAX_LENGTH = 255;

export interface RuleInput {
  name: string;
  active?: boolean;
  match: RuleMatch;
  stopProcessing: boolean;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

/** What an unsaved rule needs for a preview. */
export interface RuleDraft {
  match: RuleMatch;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

/** The final change a matching transaction would get; empty when it would not change. */
export interface RulePreviewChanges {
  addTagKeys?: number[];
  categoryKey?: number;
  description?: string;
  hidden?: true;
  merchant?: { merchantKey: number | null; name: string };
  notes?: string;
  reviewed?: true;
}

export interface RulePreviewRow {
  transactionKey: number;
  transactionDate: string | null;
  description: string | null;
  merchantName: string | null;
  accountName: string | null;
  amount: number | null;
  currency: string | null;
  categoryKey: number | null;
  hidden: boolean;
  changes: RulePreviewChanges;
}

export interface RulePreview {
  /** Transactions the rule matches, including ones it would leave as they are. */
  matchCount: number;
  /** Matching transactions that would change. */
  changeCount: number;
  /** The most recent matches, newest first. */
  transactions: RulePreviewRow[];
}

export const rulesKey = ["rules"] as const;

export async function getRules(
  apiClient: AxiosInstance = api,
): Promise<{ rules: Rule[] }> {
  const { data } = await apiClient.get<{ rules: Rule[] }>("/v1/rule");
  return data;
}

export default function useRules() {
  return useQuery({ queryKey: rulesKey, queryFn: () => getRules() });
}

export const invalidateRules = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: rulesKey });

export function useCreateRule() {
  return useMutation({
    mutationFn: async (input: RuleInput) => {
      const { data } = await api.post<{ rule: Rule }>("/v1/rule", input);
      return data.rule;
    },
  });
}

export function useUpdateRule() {
  return useMutation({
    mutationFn: async ({
      ruleKey,
      ...changes
    }: Partial<RuleInput> & { ruleKey: number }) => {
      const { data } = await api.patch<{ rule: Rule }>(
        `/v1/rule/${ruleKey}`,
        changes,
      );
      return data.rule;
    },
  });
}

export function useDeleteRule() {
  return useMutation({
    mutationFn: (ruleKey: number) => api.delete(`/v1/rule/${ruleKey}`),
  });
}

/**
 * Sends the household's full rule list in the new order. The API answers 409
 * `rule_order_stale` when the list no longer names exactly its live rules (the
 * other member added or deleted one meanwhile).
 */
export function useReorderRules() {
  return useMutation({
    mutationFn: async (ruleKeys: number[]) => {
      const { data } = await api.put<{ rules: Rule[] }>("/v1/rule/order", {
        ruleIds: ruleKeys,
      });
      return data.rules;
    },
  });
}

export async function previewRule(
  draft: RuleDraft,
  apiClient: AxiosInstance = api,
): Promise<RulePreview> {
  const { data } = await apiClient.post<RulePreview>("/v1/rule/preview", draft);
  return data;
}

/**
 * The preview of an unsaved rule. `draft` is null while the editor's rule is
 * incomplete; pass an already debounced value. The previous answer stays on
 * screen while the next one loads.
 */
export function useRulePreview(draft: RuleDraft | null) {
  return useQuery({
    queryKey: [...rulesKey, "preview", draft],
    queryFn: () => previewRule(draft as RuleDraft),
    enabled: draft !== null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });
}

/** What to apply to existing transactions: one rule, judged on its own, or every active rule. */
export type RuleApplyTarget = { ruleKey: number } | "all";

/** `progress` of a `rule.apply` background operation. */
export interface RuleApplyProgress {
  /** Transactions changed so far. */
  changed: number;
  /** Transactions gone through so far, out of `total`. */
  processed: number;
  total: number;
}

const applyPath = (target: RuleApplyTarget) =>
  target === "all" ? "/v1/rule/apply-all" : `/v1/rule/${target.ruleKey}/apply`;

/**
 * How many of the household's existing transactions applying `target` now
 * would change. Writes nothing; the count is exactly what applying changes.
 */
export async function countRuleApplication(
  target: RuleApplyTarget,
  apiClient: AxiosInstance = api,
): Promise<number> {
  const { data } = await apiClient.post<{ changeCount: number }>(
    applyPath(target),
    { dryRun: true },
  );
  return data.changeCount;
}

export function useRuleApplicationCount(target: RuleApplyTarget) {
  return useQuery({
    queryKey: [...rulesKey, "apply-count", target],
    queryFn: () => countRuleApplication(target),
    // Always the current count: it is what the person confirms.
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
}

/**
 * Starts applying `target` in the background and resolves to the operation id
 * to follow with `useBackgroundOperation`. The API answers 409
 * `rule_apply_in_progress` while another run is going.
 */
export function useApplyRules() {
  return useMutation({
    mutationFn: async (target: RuleApplyTarget) => {
      const { data } = await api.post<{ operationId: string }>(
        applyPath(target),
        { dryRun: false },
      );
      return data.operationId;
    },
  });
}
