"use client";

import { Check, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import CategorySelect from "@/components/CategorySelect";
import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/MoneyInput";
import {
  fillRemainder,
  formatUnitsForInput,
  newSplitLineId,
  type SplitDraftLine,
  splitEvenly,
  type SplitSummary,
  unitsToNumber,
} from "@/lib/account/transaction-split";
import type { Category } from "@/lib/api/category/useCategories";
import { cn } from "@/lib/utils";

/** The API takes at most this many lines per split. */
export const MAX_SPLIT_LINES = 50;

export interface TransactionSplitEditorProps {
  lines: SplitDraftLine[];
  onLinesChange: (lines: SplitDraftLine[]) => void;
  /** `summarizeSplit(lines, totalUnits, locale)`, computed by the owner, which gates saving. */
  summary: SplitSummary;
  /** The transaction's amount in its settlement currency, in 0.0001 units, signed. */
  totalUnits: bigint;
  /** The settlement currency: lines are in it. */
  currency: string;
  categories: Category[];
  disabled?: boolean;
}

/**
 * The lines of a split: a category, an amount (or a percentage) and a note each, with what is
 * left to assign shown live. Controlled: the owner keeps the lines and decides when to save.
 */
export function TransactionSplitEditor({
  lines,
  onLinesChange,
  summary,
  totalUnits,
  currency,
  categories,
  disabled = false,
}: TransactionSplitEditorProps) {
  const t = useTranslations("transactionSplit");
  const locale = useLocale();

  const update = (index: number, change: Partial<SplitDraftLine>) =>
    onLinesChange(
      lines.map((line, i) => (i === index ? { ...line, ...change } : line)),
    );

  const remove = (index: number) =>
    onLinesChange(lines.filter((_, i) => i !== index));

  const add = () =>
    onLinesChange([
      ...lines,
      { id: newSplitLineId(), categoryKey: null, amount: "", notes: "" },
    ]);

  const evenly = () => {
    const amounts = splitEvenly(totalUnits, lines.length);
    onLinesChange(
      lines.map((line, i) => ({
        ...line,
        amount: formatUnitsForInput(amounts[i]!, locale),
      })),
    );
  };

  /** A percentage becomes the figure it stands for once the field is left. */
  const settlePercentage = (index: number) => {
    const line = lines[index];
    const units = summary.lines[index]?.units;
    if (!line || !line.amount.trim().endsWith("%") || units == null) return;
    update(index, { amount: formatUnitsForInput(units, locale) });
  };

  const remaining = summary.remainingUnits;
  const over = remaining !== 0n && remaining < 0n !== totalUnits < 0n;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{t("total")}</span>
        <Amount
          value={unitsToNumber(totalUnits)}
          currency={currency}
          className="font-mono"
        />
      </div>

      <ol className="space-y-2" aria-label={t("lines")}>
        {lines.map((line, index) => {
          const number = index + 1;
          const result = summary.lines[index];
          const error = result?.error ?? null;
          const errorId = `${line.id}-error`;
          const filled =
            remaining === 0n
              ? null
              : fillRemainder(result?.units ?? null, remaining, totalUnits);
          return (
            <li
              key={line.id}
              className="border-border space-y-2 rounded-md border p-2"
            >
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <CategorySelect
                    categories={categories}
                    initialValue={line.categoryKey ?? undefined}
                    onChange={(value) => update(index, { categoryKey: value })}
                    triggerProps={{
                      "aria-label": t("line-category", { number }),
                      className: "text-foreground ml-0! w-full",
                      disabled,
                      size: "sm",
                      variant: "outline",
                    }}
                  />
                </div>
                <MoneyInput
                  aria-label={t("line-amount", { number })}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  className="h-9 w-28 px-3"
                  disabled={disabled}
                  value={line.amount}
                  onChange={(event) =>
                    update(index, { amount: event.target.value })
                  }
                  onBlur={() => settlePercentage(index)}
                />
              </div>
              <div className="flex items-center gap-1">
                <Input
                  aria-label={t("line-notes", { number })}
                  className="h-8 flex-1 px-3 text-xs"
                  disabled={disabled}
                  maxLength={500}
                  placeholder={t("notes-placeholder")}
                  value={line.notes}
                  onChange={(event) =>
                    update(index, { notes: event.target.value })
                  }
                />
                {filled !== null ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-xs"
                    aria-label={t("fill-remainder-label", { number })}
                    disabled={disabled}
                    onClick={() =>
                      update(index, {
                        amount: formatUnitsForInput(filled, locale),
                      })
                    }
                  >
                    {t("fill-remainder")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={t("remove-line", { number })}
                  disabled={disabled || lines.length <= 2}
                  onClick={() => remove(index)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
              {error ? (
                <p id={errorId} className="text-destructive-text text-xs">
                  {t(`line-errors.${error}`)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="text-muted-foreground text-xs">{t("amount-hint")}</p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || lines.length >= MAX_SPLIT_LINES}
          onClick={add}
        >
          <Plus className="size-4" aria-hidden />
          {t("add-line")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={evenly}
        >
          {t("split-evenly")}
        </Button>
      </div>

      {/* The live remainder. Words, not only colour, say which way it is off. */}
      <div
        aria-live="polite"
        className={cn(
          "flex items-baseline justify-between gap-3 rounded-md px-3 py-2 text-sm",
          remaining === 0n
            ? "bg-success/10 text-success-text"
            : over
              ? "bg-destructive/10 text-destructive-text"
              : "bg-muted text-foreground",
        )}
      >
        {remaining === 0n ? (
          <span className="flex items-center gap-1.5 font-medium">
            <Check className="size-4" aria-hidden />
            {t("balanced")}
          </span>
        ) : (
          <>
            <span className="font-medium">
              {over ? t("over") : t("remaining")}
            </span>
            <Amount
              value={Math.abs(unitsToNumber(remaining))}
              currency={currency}
              className="font-mono font-semibold"
            />
          </>
        )}
      </div>
    </div>
  );
}
