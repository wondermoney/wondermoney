"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ChartBar,
  ChartLine,
  DollarSign,
  Info,
  TriangleAlert,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import BudgetTableNew, {
  type BudgetRow,
  type BudgetSubRow,
} from "@/components/budget/BudgetTableNew";
import WizardAddCategoryForm from "@/components/budget/WizardAddCategoryForm";
import { Alert, AlertTitle } from "@/components/ui/Alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CategoryIcon from "@/components/ui/CategoryIcon";
import { LearningTip } from "@/components/ui/learning-tip";
import { Spinner } from "@/components/ui/Spinner";
import { StatCard, StatCardGrid } from "@/components/ui/StatCard";
import { Heading } from "@/components/ui/Typography";
import Text from "@/components/ui/Typography/Text";
import { useRouter } from "@/i18n/navigation";
import useBudget from "@/lib/api/budget/useBudget";
import useBudgetTemplateByDate, {
  BudgetCategory,
} from "@/lib/api/budget/useBudgetTemplateByYearAndMonth";
import useEditBudgetCategory from "@/lib/api/budget/useEditBudgetCategory";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import { useUser } from "@/lib/auth/user-context";
import {
  completeFirstRunHandoff,
  getFirstRunStepRoute,
} from "@/lib/onboarding/firstRunOnboarding";
import { cn } from "@/lib/utils";
import {
  getBudgetRowMonthlyBudgetedTotal,
  getMonthlyBudgetedValue,
} from "@/lib/utils/budget";
import {
  applyBudgetStarterProfileToBudgetRows,
  BUDGET_STARTER_PROFILES,
  type BudgetStarterProfileKey,
  calculateStarterProfileMonthlyTotal,
} from "@/lib/utils/budget-wizard";
import { getCategoryTranslationKey } from "@/lib/utils/categories";
import { convertRecurrencyIntoMonthsInYear } from "@/lib/utils/recurrency";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

import { useRequireWizardBudget } from "../hooks/useRequireWizardBudget";
import { useBudgetWizardStore } from "../store";

// Code-split heavy chart component
const BudgetPieChart = dynamic(
  () => import("@/components/budget/BudgetPieChart"),
  { loading: () => <Spinner /> },
);

export default function CategoriesPage() {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const formatCurrency = useFormatCurrency();
  const {
    budgetId,
    household,
    dependents,
    starterProfileKey,
    setStarterProfileSelection,
    resetWizard,
  } = useBudgetWizardStore(
    useShallow((state) => ({
      budgetId: state.budgetId,
      household: state.household,
      dependents: state.dependents,
      starterProfileKey: state.starterProfileKey,
      setStarterProfileSelection: state.setStarterProfileSelection,
      resetWizard: state.reset,
    })),
  );
  const router = useRouter();
  const user = useUser();
  const queryClient = useQueryClient();
  const editBudgetCategoryMutation = useEditBudgetCategory();
  const [isMethodologyOpen, setIsMethodologyOpen] = useState(false);
  const [isApplyingStarterProfile, setIsApplyingStarterProfile] =
    useState(false);

  const leaveWizard = useRequireWizardBudget(budgetId, router);

  const { data: budgetData, isLoading: isLoadingBudget } = useBudget(
    budgetId!,
    { enabled: !!budgetId, staleTime: 0 },
  );

  const { data: budgetTemplateData, isLoading: isLoadingBudgetTemplate } =
    useBudgetTemplateByDate(
      {
        budgetKey: Number(budgetId),
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
      },
      { enabled: !!budgetData, staleTime: 0 },
    );

  const averageMonthlyIncome = (
    budgetTemplateData?.budget.incomes ?? []
  ).reduce((acc, income) => acc + income.amount, 0);

  const data = useMemo(() => {
    if (!budgetTemplateData) return null;

    // Group child categories by parent category name
    const childCategoriesByParent: Record<string, BudgetCategory[]> = {};
    for (const category of budgetTemplateData.budget.categories) {
      if (category.child_category_name !== null) {
        const parentName = category.parent_category_name;
        childCategoriesByParent[parentName] =
          childCategoriesByParent[parentName] || [];
        childCategoriesByParent[parentName].push(category);
      }
    }

    // Create parent rows and child rows, using the childCategoriesByParent map
    const tableRows: BudgetRow[] = [];
    for (const category of budgetTemplateData.budget.categories) {
      const isParentCategory = category.child_category_name === null;
      const categoryName =
        category.child_category_name || category.parent_category_name;

      if (isParentCategory) {
        const parentRow: BudgetRow = {
          key: category.category_key,
          name: categoryName,
          budgeted: category.category_budgeted_amount,
          recurrency: category.category_recurrency
            ? convertRecurrencyIntoMonthsInYear(category.category_recurrency)
            : undefined,
          icon: category.category_icon,
          textColor: category.category_text_color,
          bgColor: category.category_bg_color,
          isSystemCategory: category.category_is_system_category,
          subRows: [],
        };
        tableRows.push(parentRow);

        const childCategories = childCategoriesByParent[categoryName] || [];
        for (const childCategory of childCategories) {
          const childRow: BudgetSubRow = {
            key: childCategory.category_key,
            name: childCategory.child_category_name ?? "",
            budgeted: childCategory.category_budgeted_amount,
            icon: childCategory.category_icon,
            textColor: childCategory.category_text_color,
            bgColor: childCategory.category_bg_color,
            isSystemCategory: childCategory.category_is_system_category,
            recurrency: childCategory.category_recurrency
              ? convertRecurrencyIntoMonthsInYear(
                  childCategory.category_recurrency,
                )
              : 12,
          };
          parentRow.subRows.push(childRow);
        }
      }
    }

    return tableRows;
  }, [budgetTemplateData]);

  const [budgetRows, setBudgetRows] = useState<BudgetRow[] | null>(data);
  // Reset the editable rows when the template data changes (adjusted during
  // render rather than in an effect).
  const [prevData, setPrevData] = useState(data);
  if (data !== prevData) {
    setPrevData(data);
    if (data) setBudgetRows(data);
  }

  const currentBudgetRows = budgetRows ?? data;

  const selectedStarterSuggestions = useMemo(() => {
    if (!starterProfileKey) return [];

    return applyBudgetStarterProfileToBudgetRows({
      rows: currentBudgetRows ?? [],
      profileKey: starterProfileKey,
      averageMonthlyIncome,
      householdSize: household?.householdSize,
      dependentCount: dependents?.dependentsNum,
    }).suggestions;
  }, [
    averageMonthlyIncome,
    currentBudgetRows,
    dependents,
    household,
    starterProfileKey,
  ]);

  const totalMonthlyExpenses = useMemo(() => {
    if (!currentBudgetRows) return 0;

    return getBudgetRowMonthlyBudgetedTotal(currentBudgetRows);
  }, [currentBudgetRows]);

  const budgetRemaining = averageMonthlyIncome - totalMonthlyExpenses;
  const budgetUtilization =
    averageMonthlyIncome > 0
      ? (totalMonthlyExpenses / averageMonthlyIncome) * 100
      : 0;

  const topCategories = useMemo(() => {
    if (!currentBudgetRows) return { highest: [], lowest: [] };

    // Calculate normalized budget amounts for each category
    const categoriesWithNormalizedBudget = currentBudgetRows
      .map((row) => {
        const normalizedBudget = getMonthlyBudgetedValue(row);

        return {
          name: row.name,
          amount: normalizedBudget,
          percentage:
            totalMonthlyExpenses > 0
              ? (normalizedBudget / totalMonthlyExpenses) * 100
              : 0,
          isSystemCategory: row.isSystemCategory,
          icon: row.icon,
          bgColor: row.bgColor,
          textColor: row.textColor,
        };
      })
      // Filter out categories with zero budget
      .filter((category) => category.amount > 0);

    // Sort by percentage descending for highest spending
    const highest = [...categoriesWithNormalizedBudget]
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 5);

    return { highest };
  }, [currentBudgetRows, totalMonthlyExpenses]);

  const getBudgetRemainingStatus = () => {
    if (budgetRemaining < 0) return "negative";
    if (budgetRemaining === 0) return "neutral";
    return "positive";
  };

  // Money still sitting unallocated is an ordinary state, not an achievement.
  // Painting the positive branch `bg-success-text/5` with green ink would make
  // an under-allocated budget — the state a first-time wizard user is
  // *always* in — read as a win, and spend the register §5
  // reserves for positive money movement on a figure that has not moved
  // anywhere yet. Positive and zero share the plain tile and ordinary ink.
  //
  // Over-allocation is genuinely semantic and keeps `--destructive-text`; that
  // now travels through `<StatCard tone="threshold">`, which marks the figure
  // itself on the breach side only rather than washing the whole tile.
  //
  // Colour is never the only cue here — the sign is in the formatted amount
  // and the icon changes shape with the state.
  const RemainingStatusIcon =
    getBudgetRemainingStatus() === "negative" ? TriangleAlert : ChartLine;

  const currencyCode = budgetTemplateData?.budget.currencyCode ?? "EUR";

  const formatCurrencyValue = (amount: number) => {
    return formatCurrency(
      amount,
      budgetTemplateData?.budget.currencyCode ?? "EUR",
    );
  };

  // Selecting a profile card must not write the suggested amounts into
  // `budgetRows`: the table and totals would already show them by the time
  // the user reached "Apply suggestions" below, so clicking it would visibly
  // do nothing even though the click is what persists it. Picking
  // a profile only records the selection so `selectedStarterSuggestions`
  // can render the preview card; the budget table itself is left untouched
  // until Apply actually applies (and saves) it.
  const onStarterProfileSelect = (profileKey: BudgetStarterProfileKey) => {
    setStarterProfileSelection(profileKey);
  };

  const onApplyStarterProfile = async () => {
    if (
      !currentBudgetRows ||
      !starterProfileKey ||
      starterProfileKey === "custom" ||
      selectedStarterSuggestions.length === 0 ||
      !budgetId ||
      isApplyingStarterProfile
    ) {
      return;
    }

    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;
    const budgetKey = Number(budgetId);

    // Compute the suggested rows (and which categories actually change)
    // against the *current* table state, not the original query data — this
    // correctly accounts for any manual edits the user made before clicking
    // Apply, and for re-applying after switching starter profiles.
    const {
      rows: suggestedRows,
      matchedCount,
      changedRows,
    } = applyBudgetStarterProfileToBudgetRows({
      rows: currentBudgetRows,
      profileKey: starterProfileKey,
      averageMonthlyIncome,
      householdSize: household?.householdSize,
      dependentCount: dependents?.dependentsNum,
    });

    if (matchedCount === 0) {
      toast(t("budget-starter-profile-no-match"));
      return;
    }

    if (changedRows.length === 0) {
      toast(t("budget-starter-profile-already-applied"));
      return;
    }

    setIsApplyingStarterProfile(true);

    try {
      await Promise.all(
        changedRows.map(({ categoryKey, amount }) =>
          editBudgetCategoryMutation.mutateAsync({
            categoryKey,
            amount,
            budgetKey,
            year,
            month,
          }),
        ),
      );

      // Only now — after the amounts are actually saved — update the visible
      // table, so clicking Apply is what the user sees change.
      setBudgetRows(suggestedRows);

      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["budget-template-year-month", budgetKey, month, year],
        }),
        queryClient.invalidateQueries({
          queryKey: ["budget", budgetKey],
        }),
      ]).catch(() => undefined);

      toast.success(t("budget-starter-profile-applied"));
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
          duration: 9000,
        });
        return;
      }

      toast.error(t("server-error"));
    } finally {
      setIsApplyingStarterProfile(false);
    }
  };

  const starterSuggestionTotal = calculateStarterProfileMonthlyTotal(
    selectedStarterSuggestions,
  );

  const onBudgetComplete = () => {
    // This wizard's store isn't route-scoped or persisted — it's a
    // module-level Zustand store that otherwise keeps household/dependents/
    // income/budgetId around after this "Finish". A later visit that lands
    // back on an earlier step (browser Back, a stale tab) would then find a
    // budgetId already set and treat this finished attempt as still
    // in-progress, resuming/duplicating it instead of starting clean.
    // Capture the id the redirect below needs before clearing state.
    const completedBudgetId = budgetId;
    leaveWizard();
    resetWizard();

    const handled = completeFirstRunHandoff(
      "budget",
      {
        budgetStep: "started",
        currentStep: "completion",
        portfolioStep: "skipped" as const,
      },
      user?.id,
    );

    if (handled) {
      router.replace(getFirstRunStepRoute("completion"));
      return;
    }

    router.replace(
      `/budgets/${completedBudgetId}/${new Date().getFullYear()}/${new Date().getMonth() + 1}`,
    );
  };

  // Show full page spinner while loading
  if (isLoadingBudget || isLoadingBudgetTemplate || !budgetTemplateData) {
    return (
      <div className="mb-8 flex flex-col justify-center gap-8">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col items-center gap-2">
            <Heading variant="h2">{t("how-much-are-you-spending")}</Heading>
            <Text variant="mutedText">
              {t("the-best-way-to-save-money-is-to-control-your-spendings")}
            </Text>
          </div>
          <div className="mx-auto flex min-h-64 max-w-5xl items-center justify-center">
            <Spinner />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8 flex flex-col justify-center gap-8">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col items-center gap-2">
          <Heading variant="h2">{t("how-much-are-you-spending")}</Heading>
          <Text variant="mutedText">
            {t("the-best-way-to-save-money-is-to-control-your-spendings")}
          </Text>
        </div>

        <div className="mx-auto flex min-h-64 max-w-5xl flex-col gap-8">
          {/* Budget Summary Cards — the shared StatCard grid the rest of the
              app uses. */}
          <StatCardGrid>
            <StatCard
              icon={DollarSign}
              label={t("monthly-income")}
              value={averageMonthlyIncome}
              currency={currencyCode}
              help={{
                tooltip: t("monthly-income-tooltip"),
                ariaLabel: t("monthly-income-help-label"),
              }}
            />
            <StatCard
              icon={ChartBar}
              label={t("total-budgeted")}
              value={totalMonthlyExpenses}
              currency={currencyCode}
              help={{
                tooltip: t("total-budgeted-tooltip"),
                ariaLabel: t("total-budgeted-help-label"),
              }}
            />
            <StatCard
              icon={RemainingStatusIcon}
              label={t("budget-remaining")}
              value={budgetRemaining}
              currency={currencyCode}
              // A remaining budget is a level that means something different
              // once it goes negative, so it is marked on the breach side only.
              tone="threshold"
              helper={`${formatPercentage(budgetUtilization / 100, {
                maximumFractionDigits: 1,
              })} ${t("budget-utilization").toLowerCase()}`}
              help={{
                tooltip:
                  getBudgetRemainingStatus() === "negative"
                    ? t("budget-remaining-negative-tooltip")
                    : t("budget-remaining-positive-tooltip"),
                ariaLabel: t("budget-remaining-help-label"),
              }}
            />
          </StatCardGrid>

          <Alert variant="info">
            <Info className="size-4" />
            <div className="flex-1">
              <AlertTitle className="mb-0 font-normal">
                {t("budget-calculation-explanation", {
                  income: formatCurrencyValue(averageMonthlyIncome),
                })}
              </AlertTitle>
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-sm"
                aria-expanded={isMethodologyOpen}
                aria-controls="budget-calculation-methodology"
                onClick={() => setIsMethodologyOpen((isOpen) => !isOpen)}
              >
                {t("budget-calculation-methodology-title")}
              </Button>
              {isMethodologyOpen && (
                <Text
                  id="budget-calculation-methodology"
                  variant="mutedText"
                  className="mt-2"
                >
                  {t("budget-calculation-methodology")}
                </Text>
              )}
            </div>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>{t("budget-starter-profile-title")}</CardTitle>
              <Text variant="mutedText">
                {t("budget-starter-profile-description")}
              </Text>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-5" role="radiogroup">
                {BUDGET_STARTER_PROFILES.map((profile) => {
                  const isSelected = starterProfileKey === profile.key;

                  return (
                    <Button
                      key={profile.key}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      variant={isSelected ? "default" : "outline"}
                      className={cn(
                        "h-auto flex-col items-start justify-start gap-1 px-3 py-3 text-left whitespace-normal",
                        !isSelected && "text-foreground",
                      )}
                      onClick={() => onStarterProfileSelect(profile.key)}
                    >
                      <span className="font-semibold">
                        {t(profile.labelKey)}
                      </span>
                      {/* Not `text-muted-foreground`: the outline variant
                          tints to `primary/10` on hover, and muted ink on that
                          tint measures 4.34:1 — so the sub-label dropped under
                          the floor exactly while the user was pointing at it.
                          A foreground wash holds at 6.44:1 light / 8.56:1 dark
                          on the same tint and still reads as secondary. */}
                      <span
                        className={cn(
                          "text-xs leading-5",
                          isSelected
                            ? "text-primary-foreground/80"
                            : "text-foreground/70",
                        )}
                      >
                        {t(profile.descriptionKey)}
                      </span>
                    </Button>
                  );
                })}
              </div>

              {starterProfileKey && (
                <div className="bg-muted/40 rounded-lg border p-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <Text variant="mutedText">
                      {selectedStarterSuggestions.length > 0
                        ? t("budget-starter-profile-selected-summary", {
                            income: formatCurrencyValue(averageMonthlyIncome),
                            total: formatCurrencyValue(starterSuggestionTotal),
                          })
                        : t("budget-starter-profile-empty")}
                    </Text>
                    {selectedStarterSuggestions.length > 0 && (
                      <Text variant="smallText" className="font-mono">
                        {t("budget-starter-profile-suggested-total")}:{" "}
                        {formatCurrencyValue(starterSuggestionTotal)}
                      </Text>
                    )}
                  </div>

                  {selectedStarterSuggestions.length > 0 && (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {selectedStarterSuggestions.map((suggestion) => (
                        <div
                          key={suggestion.key}
                          className="bg-background flex items-center justify-between rounded-md px-3 py-2 text-sm"
                        >
                          <span>{t(suggestion.labelKey)}</span>
                          <span className="font-mono font-medium">
                            {formatCurrencyValue(suggestion.monthlyAmount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedStarterSuggestions.length > 0 && (
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <Text variant="mutedText">
                        {t("budget-starter-profile-apply-note")}
                      </Text>
                      <Button
                        type="button"
                        onClick={onApplyStarterProfile}
                        className="sm:self-start"
                        loading={isApplyingStarterProfile}
                        disabled={isApplyingStarterProfile}
                      >
                        {t("budget-starter-profile-apply")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* One banner on this screen, not two. "Click any amount to edit…"
              was a second full-width outlined `Alert` carrying a tooltip's
              worth of content, stacked under the one that actually explains
              where the suggested amounts came from — two alert boxes in a
              column and neither reads as important. The instruction now lives
              in the tooltip this heading already had, behind the visible
              "How to adjust amounts" affordance that was already pointing at
              it. */}
          <div className="flex items-center gap-2">
            <Heading variant="h4">{t("budget-categories")}</Heading>
            <LearningTip
              tooltip={t("budget-categories-tooltip")}
              ariaLabel={t("budget-categories-help-label")}
            >
              {t("budget-categories-help")}
            </LearningTip>
          </div>

          <BudgetTableNew
            budget={currentBudgetRows ?? []}
            budgetKey={Number(budgetId)}
            year={new Date().getFullYear()}
            month={new Date().getMonth() + 1}
            monthlyIncome={averageMonthlyIncome}
            currency={budgetTemplateData.budget.currencyCode}
            onBudgetChange={setBudgetRows}
          />

          {/* Add Category Section */}
          <WizardAddCategoryForm budgetId={String(budgetId!)} />
        </div>

        {/* Budget Distribution Section */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Budget Distribution - Pie Chart */}
          <BudgetPieChart
            data={currentBudgetRows ?? []}
            currency={budgetTemplateData.budget.currencyCode}
          />

          {/* Category Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>{t("category-breakdown")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {topCategories.highest.length > 0 ? (
                  topCategories.highest.map((category, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="flex size-10 items-center justify-center rounded-md"
                          style={{
                            backgroundColor: category.bgColor,
                            color: category.textColor,
                          }}
                        >
                          <CategoryIcon
                            icon={category.icon}
                            className="text-current"
                          />
                        </div>
                        <Text className="font-medium">
                          {category.isSystemCategory
                            ? t(getCategoryTranslationKey(category.name))
                            : category.name}
                        </Text>
                      </div>
                      <div className="flex flex-col items-end">
                        <Text className="font-semibold">
                          {formatCurrencyValue(category.amount)}
                        </Text>
                        <Text
                          variant="smallText"
                          className="text-muted-foreground"
                        >
                          {formatPercentage(category.percentage / 100)}
                        </Text>
                      </div>
                    </div>
                  ))
                ) : (
                  <Text variant="mutedText" className="py-8 text-center">
                    {t("no-categories-with-budget-yet")}
                  </Text>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <div className="flex justify-center">
        <Button type="button" onClick={onBudgetComplete}>
          {t("finish")}
        </Button>
      </div>
    </div>
  );
}
