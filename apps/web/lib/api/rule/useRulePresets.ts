import { useMutation, useQuery } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { rulesKey } from "./useRules";

/**
 * Locale rule presets, as `/v1/rule/presets` serves them: short lists of
 * well-known national merchants (a supermarket is groceries, a utility is
 * electricity) a household can add to its rules in one go. A preset only ever
 * sets categories, merchants and descriptions on money out; it never touches
 * income, transfers or hidden transactions.
 *
 * Its rules use the rules export format: categories by system key
 * (`{ system: "GROCERIES" }`), merchants by name.
 */
export interface RulePresetSummary {
  code: string;
  countries: string[];
  language: string;
  revision: number;
  ruleCount: number;
  /** Preset rules the household already has a rule of the same name for. */
  installedCount: number;
  installed: boolean;
}

export interface RulePresetList {
  presets: RulePresetSummary[];
  /** The preset matching the person's language and country, if any. */
  suggested: string | null;
}

export type RulePresetCondition =
  | {
      field: "description";
      operator: string;
      source?: "cleaned" | "raw";
      value: string;
    }
  | { field: "merchant"; operator: string; value: string }
  | { field: "direction"; operator: "is"; value: "in" | "out" }
  | { field: string; operator: string; [key: string]: unknown };

export type RulePresetAction =
  | { type: "set_category"; category: { system: string } | { name: string } }
  | { type: "set_merchant"; merchant: string }
  | { type: "set_description"; value: string };

/** `new` is added; `installed` is skipped as already there; `unavailable` names a category this instance lacks. */
export type RulePresetRuleStatus = "new" | "installed" | "unavailable";

export interface RulePresetRule {
  name: string;
  match: "all" | "any";
  conditions: RulePresetCondition[];
  actions: RulePresetAction[];
  status: RulePresetRuleStatus;
}

export interface RulePresetPreview {
  preset: RulePresetSummary;
  rules: RulePresetRule[];
}

export interface RulePresetInstallResult {
  created: string[];
  skipped: string[];
  preset: RulePresetSummary;
}

/** What the client knows about where the person is; the API adds their bank countries and currency. */
export interface RulePresetLocale {
  language: string;
  region?: string;
}

/** Under the rules key, so anything that refreshes the rules refreshes the presets' status too. */
export const rulePresetsKey = [...rulesKey, "presets"] as const;

export async function getRulePresets(
  locale: RulePresetLocale,
  apiClient: AxiosInstance = api,
): Promise<RulePresetList> {
  const { data } = await apiClient.get<RulePresetList>("/v1/rule/presets", {
    params: locale,
  });
  return data;
}

export function useRulePresets(locale: RulePresetLocale) {
  return useQuery({
    queryKey: [...rulePresetsKey, locale],
    queryFn: () => getRulePresets(locale),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export async function getRulePresetPreview(
  code: string,
  apiClient: AxiosInstance = api,
): Promise<RulePresetPreview> {
  const { data } = await apiClient.get<RulePresetPreview>(
    `/v1/rule/presets/${encodeURIComponent(code)}`,
  );
  return data;
}

/** Everything a preset would add, rule by rule. `code` is null while nothing is chosen. */
export function useRulePresetPreview(code: string | null) {
  return useQuery({
    queryKey: [...rulePresetsKey, "preview", code],
    queryFn: () => getRulePresetPreview(code as string),
    enabled: code !== null,
    // Always current: it is what the person confirms.
    staleTime: 0,
    retry: false,
  });
}

/** Adds the preset's rules the household does not have yet; installing again adds nothing. */
export async function installRulePreset(
  code: string,
  apiClient: AxiosInstance = api,
): Promise<RulePresetInstallResult> {
  const { data } = await apiClient.post<RulePresetInstallResult>(
    `/v1/rule/presets/${encodeURIComponent(code)}/install`,
  );
  return data;
}

export function useInstallRulePreset() {
  return useMutation({ mutationFn: (code: string) => installRulePreset(code) });
}
