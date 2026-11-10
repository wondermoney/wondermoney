"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import useAccounts from "@/lib/api/account/useAccounts";
import useCategories from "@/lib/api/category/useCategories";
import useConfigs from "@/lib/api/configs/useConfigs";
import useTags from "@/lib/api/tag/useTags";
import type { SummaryLookups } from "@/lib/rules/rule-summary";
import {
  getCategoryDisplayName,
  getSelectableCategories,
} from "@/lib/utils/categories";

/**
 * Names for what rules refer to by key (categories, accounts, tags,
 * transaction types, currencies), and the option lists the editor offers.
 * Everything comes from queries other screens already cache.
 */
export function useRuleLookups() {
  const t = useTranslations();
  const locale = useLocale();
  const { data: categoriesData } = useCategories();
  const { data: accountsData } = useAccounts();
  const { data: tagsData } = useTags();
  const { data: configsData } = useConfigs();

  return useMemo(() => {
    const categories = categoriesData?.categories ?? [];
    const selectableCategories = getSelectableCategories(categories);
    const categoryName = new Map(
      selectableCategories.map((category) => [
        category.categoryKey,
        getCategoryDisplayName(t, category.name),
      ]),
    );
    const accounts = accountsData?.accounts ?? [];
    const accountName = new Map(
      accounts.map((account) => [
        account.accountKey,
        account.accountName ?? t("unknown"),
      ]),
    );
    const tags = tagsData?.tags ?? [];
    const tagName = new Map(tags.map((tag) => [tag.tagKey, tag.name]));
    const transactionTypeLabel = (name: string) => {
      const key = `transaction-type-${name.toUpperCase()}`;
      return t.has(key) ? t(key) : name;
    };
    const amountFormat = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 4,
    });

    // Until a list has loaded, a name reads as an ellipsis rather than as
    // "deleted", which only a loaded list can tell.
    const pending = (loaded: unknown) => (loaded ? undefined : "…");
    const lookups: SummaryLookups = {
      category: (key) => categoryName.get(key) ?? pending(categoriesData),
      account: (key) => accountName.get(key) ?? pending(accountsData),
      tag: (key) => tagName.get(key) ?? pending(tagsData),
      transactionType: transactionTypeLabel,
      amount: (value) => amountFormat.format(value),
    };

    const options = {
      categories: selectableCategories.map((category) => ({
        value: String(category.categoryKey),
        label: categoryName.get(category.categoryKey) ?? category.name,
      })),
      accounts: accounts.map((account) => ({
        value: String(account.accountKey),
        label: accountName.get(account.accountKey) ?? "",
      })),
      transactionTypes: (configsData?.transactionTypes ?? []).map((type) => ({
        value: type.name.toUpperCase(),
        label: transactionTypeLabel(type.name),
      })),
      currencies: (configsData?.currencies ?? []).map((currency) => ({
        value: currency.code,
        label: `${currency.code} (${currency.description})`,
      })),
    };

    return { categories, lookups, options };
  }, [accountsData, categoriesData, configsData, locale, t, tagsData]);
}
