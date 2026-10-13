"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MoreHorizontal, Pencil, Trash } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import React, { useEffect, useState } from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import { useWatch } from "react-hook-form";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import { IncomeAmountEditButton } from "@/components/budget/IncomeAmountEditButton";
import IncomeNewEditDialog, {
  IncomeData as SingleIncomeData,
} from "@/components/budget/IncomeNewEditDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Form, FormContent } from "@/components/ui/Form";
import { Label } from "@/components/ui/Label";
import { LearningTip } from "@/components/ui/learning-tip";
import { Heading } from "@/components/ui/Typography";
import Text from "@/components/ui/Typography/Text";
import { useRouter } from "@/i18n/navigation";
import useAccounts from "@/lib/api/account/useAccounts";
import useCreateBudget from "@/lib/api/budget/useCreateBudget";
import useEditBudgetTemplateAccounts from "@/lib/api/budget/useEditBudgetTemplateAccounts";
import {
  calculateAnnualIncome,
  calculateAverageMonthlyIncome,
  replaceIncomeById,
  toBudgetCreateIncomes,
} from "@/lib/utils/budget-wizard";
import { formatCurrencyForLocale } from "@/lib/utils/formatCurrency";
import { convertRecurrencyIntoMonthsInYear } from "@/lib/utils/recurrency";

import { type IncomeData, incomeSchema, useBudgetWizardStore } from "../store";

export default function IncomePage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();

  const { setIncome, income, household, dependents, budgetId, setBudgetId } =
    useBudgetWizardStore(
      useShallow((state) => ({
        setIncome: state.setIncome,
        income: state.income,
        household: state.household,
        dependents: state.dependents,
        budgetId: state.budgetId,
        setBudgetId: state.setBudgetId,
      })),
    );

  // Redirect if missing previous steps
  useEffect(() => {
    if (!household || !dependents) {
      router.replace("/budgets/wizard/household");
    }
  }, [household, dependents, router]);

  const methods = useForm({
    resolver: zodResolver(incomeSchema),
    defaultValues: income || {
      incomes: [
        {
          id: Date.now().toString(),
          name: t("salary"),
          amount: 2000,
          isRecurrent: true,
          recurrency: "MONTHLY_14",
        },
      ],
    },
  });

  const incomes = useWatch({
    control: methods.control,
    name: "incomes",
  }) as IncomeData["incomes"];
  const totalAnnualIncome = calculateAnnualIncome(incomes);

  const averageMonthlyIncome = calculateAverageMonthlyIncome(incomes);
  const formatMoney = (amount: number) =>
    formatCurrencyForLocale(amount, "EUR", locale);
  const [isIncomeDialogOpen, setIsIncomeDialogOpen] = useState(false);
  const [editIncome, setEditIncome] = useState<SingleIncomeData>();

  const onIncomeCreated = (income: SingleIncomeData) => {
    methods.setValue("incomes", [
      ...(methods.getValues().incomes || []),
      income,
    ]);
  };

  const onIncomeEditOpen = (income: SingleIncomeData) => {
    setEditIncome(income);
  };

  const onIncomeEdited = (income: SingleIncomeData) => {
    const editedIncomeIndex = (methods.getValues().incomes || []).findIndex(
      (inc) => inc.id === income.id,
    );
    if (editedIncomeIndex === -1) {
      console.error("Error editing a budget");
      return;
    }

    methods.setValue(
      "incomes",
      replaceIncomeById(methods.getValues().incomes, income),
      { shouldDirty: true, shouldValidate: true },
    );
  };

  const onIncomeDeleted = (income: SingleIncomeData) => {
    methods.setValue(
      "incomes",
      (methods.getValues().incomes || []).filter((inc) => inc.id !== income.id),
    );
  };

  const createBudgetMutation = useCreateBudget();
  const editBudgetAccountsMutation = useEditBudgetTemplateAccounts();
  const { data: accountsData } = useAccounts();
  const posthog = usePostHog();

  const onSubmit: SubmitHandler<IncomeData> = async (data) => {
    if (!household || !dependents) return;

    setIncome(data);

    // RAD-633: a budget is created right here, on this step, not on the
    // wizard's final "Finish" — "Continue" on this page *is* the create
    // call. If a budgetKey is already sitting in wizard state, a budget for
    // this pass already exists (most commonly: the user went back to this
    // step after already submitting it once, e.g. via the browser Back
    // button, since this store only lives for one in-progress attempt and
    // isn't cleared until the wizard actually finishes). Re-submitting must
    // resume that budget, not silently mint a second "My Budget".
    if (budgetId) {
      router.push("/budgets/wizard/categories");
      return;
    }

    try {
      const response = await createBudgetMutation.mutateAsync({
        houseHoldSize: household.householdSize,
        dependentsNum: dependents.dependentsNum,
        incomes: toBudgetCreateIncomes(data.incomes),
      });

      posthog.capture("budget_created", {
        budget_key: response.data.budgetKey,
        household_size: household.householdSize,
        dependents_count: dependents.dependentsNum,
        incomes_count: data.incomes.length,
        source: "wizard",
      });
      setBudgetId(response.data.budgetKey);

      // RAD-633: a freshly created budget starts with zero linked accounts,
      // and the backend's "spent" figure per category is a join scoped to
      // exactly those linked accounts — not a date-range check. Left
      // unlinked, every category reads "€0.00 spent" forever, indistinguishable
      // from a genuinely quiet month, until someone finds the separate "Link
      // account" control on the budget page (components/budget/
      // BudgetAccountSelectModal.tsx). The wizard has no account-selection
      // step of its own, so it links every account the user can already see
      // by default — the same effect as opening that modal and checking all
      // of them. This is best-effort: a failure here must not block the
      // wizard, since the budget itself was already created successfully;
      // the user can still link accounts manually from the budget page.
      const accountKeys = accountsData?.accounts.map(
        (account) => account.accountKey,
      );
      if (accountKeys && accountKeys.length > 0) {
        try {
          await editBudgetAccountsMutation.mutateAsync({
            budgetKey: response.data.budgetKey,
            accountKeys,
          });
        } catch {
          // Non-fatal — see comment above.
        }
      }

      router.push("/budgets/wizard/categories");
    } catch (error) {
      toast.error(t("toast-create-budget-error"), { duration: 9000 });
    }
  };

  if (!household || !dependents) return null;

  return (
    <Form {...methods}>
      <FormContent
        className="flex w-full flex-col gap-8"
        onSubmit={methods.handleSubmit(onSubmit)}
      >
        <div className="flex flex-col">
          <Heading variant="h2" className="block text-center">
            {t("what-is-your-total-household-income")}
          </Heading>
          <Text
            variant="mutedText"
            className="text-muted-foreground mx-auto mt-2 w-full max-w-md text-center"
          >
            {t("what-is-your-total-household-income-description")}
          </Text>
          {/* Cause before result. The totals used to sit here, above the only
              control that produces them, set larger and bolder than it — the
              reader met the answer before the question. The inputs now come
              first and the derived figures follow, below. */}
          <div className="mt-10 flex flex-col gap-4">
            {incomes.map((income, index) => {
              const amountControlId = `income-${index}`;
              const paymentsPerYear =
                income.isRecurrent && income.recurrency
                  ? convertRecurrencyIntoMonthsInYear(income.recurrency)
                  : undefined;
              // One whole ICU message per case rather than a name glued to an
              // amount glued to a frequency: the order of those three parts is
              // the translator's to decide. The figure goes through the same
              // locale-aware helper as the totals below, so a screen reader
              // hears "€2.000" or "2.000 €" the way the reader's locale writes
              // it — not the raw digits the field shows.
              const editLabel =
                paymentsPerYear !== undefined
                  ? t("edit-income-source-recurring", {
                      name: income.name,
                      amount: formatMoney(income.amount),
                      count: paymentsPerYear,
                    })
                  : t("edit-income-source", {
                      name: income.name,
                      amount: formatMoney(income.amount),
                    });

              return (
                <div key={amountControlId} className="flex items-end gap-2">
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Label htmlFor={amountControlId}>{income.name}</Label>
                      {/* The recurrency was a bare `14x` glued to the inside
                          edge of the field: muted micro-text, no label, no
                          tooltip, and nothing saying what it counted. 14
                          payments a year is a Portuguese payroll convention
                          (12 months plus the two subsídios), not arithmetic
                          anyone can infer from the glyph, so it moves out of
                          the control and becomes a named figure with an
                          explanation attached. */}
                      {paymentsPerYear !== undefined && (
                        <LearningTip
                          tooltip={
                            paymentsPerYear === 14
                              ? t("income-payments-per-year-tooltip-14")
                              : t("income-payments-per-year-tooltip", {
                                  count: paymentsPerYear,
                                })
                          }
                          ariaLabel={t("income-payments-per-year-help-label")}
                        >
                          {t("income-payments-per-year", {
                            count: paymentsPerYear,
                          })}
                        </LearningTip>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Was a `readOnly` <Input> carrying the onClick that
                          opens the edit dialog. Focusable, so it looked
                          reachable, but an input does nothing on Enter or
                          Space — so the only way to correct a mistyped amount
                          on this step was the mouse. It is a real button now.
                          The wrap is deliberately narrow: the row already
                          contains two interactive elements — the LearningTip
                          above and the overflow trigger beside — and a button
                          around the whole row would nest them. */}
                      <IncomeAmountEditButton
                        id={amountControlId}
                        className="flex-1"
                        amount={income.amount}
                        label={editLabel}
                        onClick={() => onIncomeEditOpen(income)}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          {/* 44px on mobile per the touch-target rule; the
                              desktop pointer keeps the compact 32px square. */}
                          <Button
                            variant="ghost"
                            className="ml-auto flex size-11 p-0 sm:size-8"
                          >
                            <span className="sr-only">{t("open-menu")}</span>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="flex items-center gap-2"
                            onClick={() => onIncomeEditOpen(income)}
                          >
                            <Pencil className="size-4" /> {t("edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive-text flex items-center gap-2"
                            onClick={() => onIncomeDeleted(income)}
                          >
                            <Trash className="size-4" /> {t("delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* A real <button>, not a clickable <div>. As a div this was outside
              the tab order entirely, so a keyboard user could not add a second
              income source at all — and the wizard's previous step asks how
              many people live in the household. The Button primitive also
              brings the focus ring, press feedback and disabled handling that
              the hand-rolled element had none of. The "+" glyph is decorative
              once the accessible name comes from `aria-label`.

              Geometry, RAD-550: it was `h-6` — 24px, barely half the 44px
              touch floor. It is now `min-h-11`, and it takes `secondary`
              rather than a hand-rolled `bg-muted hover:bg-accent`, because
              those two tokens are byte-identical (§2) so the hover state was
              literally invisible. `secondary` also carries `border-input`,
              which is the only reason this bar has a boundary at 3:1. */}
          <Button
            type="button"
            variant="secondary"
            aria-label={t("add-another-income-source")}
            className="mt-4 min-h-11 w-full px-0 text-base font-bold"
            onClick={() => setIsIncomeDialogOpen(true)}
          >
            <span aria-hidden="true">+</span>
          </Button>
          {/* The result, after its cause and deliberately quieter than it:
              muted labels, figures in the mono face on ordinary ink. §9 caps
              `--primary` at seven placements and states outright that a
              derived figure is not one of them — emphasis here comes from the
              mono face and the aligned column, not from the accent. */}
          <dl className="border-border mt-8 flex flex-col gap-2 border-t pt-4">
            <div className="flex items-baseline justify-between gap-4">
              <Text as="dt" variant="mutedText">
                {t("total-annual-income")}
              </Text>
              <Text
                as="dd"
                variant="smallText"
                className="font-mono font-medium tabular-nums"
              >
                {formatMoney(totalAnnualIncome)}
              </Text>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <Text as="dt" variant="mutedText">
                {t("average-monthly-income")}
              </Text>
              <Text
                as="dd"
                variant="smallText"
                className="font-mono font-medium tabular-nums"
              >
                {formatMoney(averageMonthlyIncome)}
              </Text>
            </div>
          </dl>
          <Text variant="mutedText" className="mt-3">
            {t("income-used-for-guided-setup")}
          </Text>
          <IncomeNewEditDialog
            open={isIncomeDialogOpen}
            setOpen={setIsIncomeDialogOpen}
            onNewIncomeCreated={onIncomeCreated}
          />
          {editIncome && (
            <IncomeNewEditDialog
              open={true}
              setOpen={(status) => !status && setEditIncome(undefined)}
              income={editIncome}
              onIncomeEdited={onIncomeEdited}
            />
          )}
        </div>
        <div className="flex justify-center">
          <Button
            type="submit"
            loading={methods.formState.isSubmitting}
            disabled={methods.formState.isSubmitting}
          >
            {t("continue")}
          </Button>
        </div>
      </FormContent>
    </Form>
  );
}
