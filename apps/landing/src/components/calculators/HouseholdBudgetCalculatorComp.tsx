import { useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import CalculatorLayout from "./CalculatorLayout";
import BudgetSankey from "./BudgetSankey";
import {
  BUDGET_CATEGORIES,
  BUDGET_MAX_AMOUNT,
  HOUSEHOLD_BUDGET_WORKED_EXAMPLE,
  computeHouseholdBudget,
  toBudgetAmount,
  type BudgetCategory,
  type HouseholdBudgetResult,
} from "@/lib/calculators/householdBudget";
import type { SankeyNode } from "@/lib/calculators/budgetSankey";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatPercent } from "@/lib/numberFormat";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import { cn } from "@/lib/utils";

type IncomeEntry = { id: string; label: string; amount: number };
type ExpenseEntry = IncomeEntry & { category: BudgetCategory };

const INPUT_CLASS = cn(
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm",
  "focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring",
  "transition-colors",
);

const ICON_BUTTON_CLASS =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const ADD_BUTTON_CLASS =
  "inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function HouseholdBudgetCalculator({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <HouseholdBudgetCalculatorContent />
    </ReactTranslationsProvider>
  );
}

function HouseholdBudgetCalculatorContent() {
  const { t, locale } = useTranslations();
  const k = (key: string) => `tools.householdBudget.${key}`;

  // Whole euros without decimals, anything else with both cent digits.
  const money = (value: number) =>
    formatMoney(locale, value, { decimals: Number.isInteger(value) ? 0 : 2 });
  const percent = (value: number | null) => (value === null ? "—" : formatPercent(locale, value));

  const [incomes, setIncomes] = useState<IncomeEntry[]>(() =>
    HOUSEHOLD_BUDGET_WORKED_EXAMPLE.incomes.map((row) => ({
      id: `income-${row.id}`,
      label: t(k(`incomeRows.${row.id}`)),
      amount: row.amount,
    })),
  );
  const [expenses, setExpenses] = useState<ExpenseEntry[]>(() =>
    HOUSEHOLD_BUDGET_WORKED_EXAMPLE.expenses.map((row) => ({
      id: `expense-${row.id}`,
      category: row.category,
      label: t(k(`expenseRows.${row.id}`)),
      amount: row.amount,
    })),
  );
  const nextRowNumber = useRef(1);

  // One "tool_used" event per page view, on the visitor's first edit. It carries
  // no figures: what people type stays in the browser.
  const reportedUse = useRef(false);
  const markUsed = () => {
    if (reportedUse.current) return;
    reportedUse.current = true;
    pushGtmEvent({ event: "tool_used", tool: "household_budget", page_type: getPageType() });
  };

  const result = useMemo(() => computeHouseholdBudget({ incomes, expenses }), [incomes, expenses]);

  const newId = (prefix: string) => `${prefix}-added-${nextRowNumber.current++}`;

  const updateIncome = (id: string, patch: Partial<IncomeEntry>) => {
    markUsed();
    setIncomes((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };
  const removeIncome = (id: string) => {
    markUsed();
    setIncomes((rows) => rows.filter((row) => row.id !== id));
  };
  const addIncome = () => {
    markUsed();
    const id = newId("income");
    setIncomes((rows) => [...rows, { id, label: t(k("newIncomeLabel")), amount: 0 }]);
  };

  const updateExpense = (id: string, patch: Partial<ExpenseEntry>) => {
    markUsed();
    setExpenses((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };
  const removeExpense = (id: string) => {
    markUsed();
    setExpenses((rows) => rows.filter((row) => row.id !== id));
  };
  const addExpense = (category: BudgetCategory) => {
    markUsed();
    const id = newId("expense");
    setExpenses((rows) => [...rows, { id, category, label: t(k("newExpenseLabel")), amount: 0 }]);
  };

  const categoryName = (category: BudgetCategory) => t(k(`categories.${category}`));
  const incomeName = (row: IncomeEntry) => row.label.trim() || t(k("newIncomeLabel"));
  const expenseName = (row: ExpenseEntry) => row.label.trim() || t(k("newExpenseLabel"));

  const overspent = result.balance < 0;

  const labelForNode = (node: SankeyNode): string => {
    switch (node.kind) {
      case "income": {
        const row = incomes.find((entry) => entry.id === node.refId);
        return row ? incomeName(row) : t(k("newIncomeLabel"));
      }
      case "otherIncome":
        return t(k("sankey.otherIncome"), { count: node.count ?? 0 });
      case "shortfall":
        return t(k("sankey.shortfall"));
      case "total":
        return overspent ? t(k("totalExpenses")) : t(k("totalIncome"));
      case "category":
        return categoryName(node.refId as BudgetCategory);
      case "surplus":
        return t(k("surplus"));
    }
  };

  return (
    <div className="space-y-8">
      <CalculatorLayout>
        {/* Inputs */}
        <div className="space-y-6 rounded-card border border-border bg-background p-6 shadow-sm">
          <p className="text-sm text-muted-foreground">{t(k("inputsIntro"))}</p>

          <div role="group" aria-labelledby="hbIncomeHeading" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 id="hbIncomeHeading" className="text-base font-semibold text-foreground">
                {t(k("incomeHeading"))}
              </h3>
              <button type="button" onClick={addIncome} className={ADD_BUTTON_CLASS}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t(k("addIncome"))}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{t(k("incomeHelp"))}</p>
            {incomes.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                {t(k("noIncomeRows"))}
              </p>
            ) : (
              <ul className="space-y-2">
                {incomes.map((row) => (
                  <AmountRow
                    key={row.id}
                    label={row.label}
                    amount={row.amount}
                    name={incomeName(row)}
                    onLabel={(label) => updateIncome(row.id, { label })}
                    onAmount={(amount) => updateIncome(row.id, { amount })}
                    onRemove={() => removeIncome(row.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-5 border-t border-border pt-5">
            <div>
              <h3 className="text-base font-semibold text-foreground">{t(k("expensesHeading"))}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{t(k("expensesHelp"))}</p>
            </div>

            {BUDGET_CATEGORIES.map((category) => {
              const rows = expenses.filter((row) => row.category === category);
              const name = categoryName(category);
              return (
                <div
                  key={category}
                  role="group"
                  aria-labelledby={`hbCategory-${category}`}
                  className="space-y-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h4 id={`hbCategory-${category}`} className="text-sm font-medium text-foreground">
                      {name}
                    </h4>
                    <button
                      type="button"
                      onClick={() => addExpense(category)}
                      aria-label={t(k("addExpenseTo"), { category: name })}
                      className={ADD_BUTTON_CLASS}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      {t(k("addExpense"))}
                    </button>
                  </div>
                  {rows.length > 0 && (
                    <ul className="space-y-2">
                      {rows.map((row) => (
                        <AmountRow
                          key={row.id}
                          label={row.label}
                          amount={row.amount}
                          name={expenseName(row)}
                          onLabel={(label) => updateExpense(row.id, { label })}
                          onAmount={(amount) => updateExpense(row.id, { amount })}
                          onRemove={() => removeExpense(row.id)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Results */}
        <div className="space-y-6 break-words rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
          <Summary result={result} money={money} percent={percent} />

          <StatusNote result={result} money={money} />

          <figure className="space-y-3 border-t border-border pt-5">
            <figcaption>
              <span className="block text-base font-semibold text-foreground">{t(k("sankey.heading"))}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{t(k("sankey.caption"))}</span>
            </figcaption>
            {result.status === "empty" ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                {t(k("sankey.empty"))}
              </p>
            ) : (
              <BudgetSankey
                incomes={incomes}
                result={result}
                labelFor={labelForNode}
                formatMoney={money}
                title={t(k("sankey.heading"))}
                description={t(k("sankey.description"))}
              />
            )}
          </figure>
        </div>
      </CalculatorLayout>

      <BreakdownTable
        result={result}
        incomes={incomes.map((row) => ({ id: row.id, name: incomeName(row), amount: toBudgetAmount(row.amount) }))}
        money={money}
        percent={percent}
        categoryName={categoryName}
      />
    </div>
  );
}

function AmountRow({
  label,
  amount,
  name,
  onLabel,
  onAmount,
  onRemove,
}: {
  label: string;
  amount: number;
  name: string;
  onLabel: (label: string) => void;
  onAmount: (amount: number) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslations();
  const k = (key: string) => `tools.householdBudget.${key}`;

  return (
    <li className="flex items-center gap-2">
      <input
        type="text"
        value={label}
        onChange={(e) => onLabel(e.target.value)}
        aria-label={t(k("rowNameLabel"))}
        className={cn(INPUT_CLASS, "min-w-0 flex-1")}
      />
      <div className="relative w-32 shrink-0 sm:w-36">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
          {"€"}
        </span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={BUDGET_MAX_AMOUNT}
          step={10}
          value={amount}
          onChange={(e) => onAmount(toBudgetAmount(Number(e.target.value)))}
          aria-label={t(k("rowAmountLabel"), { name })}
          className={cn(INPUT_CLASS, "pl-8 font-mono")}
        />
      </div>
      <button type="button" onClick={onRemove} aria-label={t(k("removeRow"), { name })} className={ICON_BUTTON_CLASS}>
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  );
}

function Summary({
  result,
  money,
  percent,
}: {
  result: HouseholdBudgetResult;
  money: (value: number) => string;
  percent: (value: number | null) => string;
}) {
  const { t } = useTranslations();
  const k = (key: string) => `tools.householdBudget.${key}`;
  const balanceLabel =
    result.balance > 0 ? t(k("surplus")) : result.balance < 0 ? t(k("deficit")) : t(k("balance"));

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
      <div>
        <dt className="text-sm text-muted-foreground">{t(k("totalIncome"))}</dt>
        <dd className="mt-1 font-mono text-xl font-semibold text-foreground">{money(result.totalIncome)}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">{t(k("totalExpenses"))}</dt>
        <dd className="mt-1 font-mono text-xl font-semibold text-foreground">{money(result.totalExpenses)}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">{balanceLabel}</dt>
        <dd
          className={cn(
            "mt-1 font-mono text-xl font-semibold",
            result.balance > 0 && "text-success-text",
            result.balance < 0 && "text-destructive-text",
            result.balance === 0 && "text-foreground",
          )}
        >
          {money(Math.abs(result.balance))}
        </dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">{t(k("savingsRate"))}</dt>
        <dd className="mt-1 font-mono text-2xl font-bold text-primary">{percent(result.savingsRate)}</dd>
      </div>
    </dl>
  );
}

function StatusNote({ result, money }: { result: HouseholdBudgetResult; money: (value: number) => string }) {
  const { t } = useTranslations();
  const k = (key: string) => `tools.householdBudget.${key}`;

  let note: { tone: "quiet" | "deficit"; text: string } | null = null;
  switch (result.status) {
    case "deficit":
      note = { tone: "deficit", text: t(k("deficitNote"), { amount: money(-result.balance) }) };
      break;
    case "noIncome":
      note = { tone: "deficit", text: t(k("noIncomeNote")) };
      break;
    case "empty":
      note = { tone: "quiet", text: t(k("emptyNote")) };
      break;
    case "balanced":
      note = { tone: "quiet", text: t(k("balancedNote")) };
      break;
    case "surplus":
      note = result.totalExpenses === 0 ? { tone: "quiet", text: t(k("noExpensesNote")) } : null;
      break;
  }

  return (
    <div aria-live="polite">
      {note && (
        <p
          className={cn(
            "rounded-lg border px-4 py-3 text-sm text-foreground",
            note.tone === "deficit" ? "border-destructive-text/30 bg-destructive/10" : "border-border bg-paper-2",
          )}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}

function BreakdownTable({
  result,
  incomes,
  money,
  percent,
  categoryName,
}: {
  result: HouseholdBudgetResult;
  incomes: ReadonlyArray<{ id: string; name: string; amount: number }>;
  money: (value: number) => string;
  percent: (value: number | null) => string;
  categoryName: (category: BudgetCategory) => string;
}) {
  const { t } = useTranslations();
  const k = (key: string) => `tools.householdBudget.${key}`;
  const balanceLabel =
    result.balance > 0 ? t(k("surplus")) : result.balance < 0 ? t(k("deficit")) : t(k("balance"));
  // A deficit reads as a positive amount and share under its "Deficit" label,
  // as in the summary above.
  const balanceShare = result.savingsRate === null ? null : Math.abs(result.savingsRate);
  const hasIncome = result.totalIncome > 0;

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-background p-4 shadow-sm sm:p-6">
      <table className="w-full border-collapse text-sm">
        <caption className="mb-1 text-left text-base font-semibold text-foreground">
          {t(k("table.caption"))}
        </caption>
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th scope="col" className="py-2 pr-4 font-medium">
              {t(k("table.category"))}
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              {t(k("table.monthly"))}
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              {t(k("table.share"))}
            </th>
          </tr>
        </thead>
        <tbody>
          <SectionRow label={t(k("incomeHeading"))} />
          {incomes.map((row) => (
            <TableRow key={row.id} label={row.name} amount={money(row.amount)} share="" />
          ))}
          <TableRow
            label={t(k("totalIncome"))}
            amount={money(result.totalIncome)}
            share={hasIncome ? percent(100) : percent(null)}
            strong
          />
          {result.balance < 0 && (
            <TableRow
              label={t(k("sankey.shortfall"))}
              amount={money(-result.balance)}
              share=""
              tone="negative"
            />
          )}
        </tbody>
        <tbody>
          <SectionRow label={t(k("expensesHeading"))} />
          {result.categories.map((entry) => (
            <TableRow
              key={entry.category}
              label={categoryName(entry.category)}
              amount={money(entry.total)}
              share={percent(entry.shareOfIncome)}
            />
          ))}
          <TableRow
            label={t(k("totalExpenses"))}
            amount={money(result.totalExpenses)}
            share={percent(result.expensesShareOfIncome)}
            strong
          />
          <TableRow
            label={balanceLabel}
            amount={money(Math.abs(result.balance))}
            share={percent(balanceShare)}
            strong
            tone={result.balance > 0 ? "positive" : result.balance < 0 ? "negative" : undefined}
          />
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted-foreground">{t(k("table.note"))}</p>
    </div>
  );
}

function SectionRow({ label }: { label: string }) {
  return (
    <tr className="border-b border-border">
      <th scope="colgroup" colSpan={3} className="pb-2 pt-5 text-left font-semibold text-foreground">
        {label}
      </th>
    </tr>
  );
}

function TableRow({
  label,
  amount,
  share,
  strong = false,
  tone,
}: {
  label: string;
  amount: string;
  share: string;
  strong?: boolean;
  tone?: "positive" | "negative";
}) {
  return (
    <tr className="border-b border-border-2">
      <th
        scope="row"
        className={cn("py-2 pr-4 text-left text-foreground", strong ? "font-semibold" : "font-normal")}
      >
        {label}
      </th>
      <td
        className={cn(
          "py-2 pr-4 text-right font-mono",
          strong && "font-semibold",
          tone === "positive" ? "text-success-text" : tone === "negative" ? "text-destructive-text" : "text-foreground",
        )}
      >
        {amount}
      </td>
      <td className={cn("py-2 text-right font-mono text-foreground", strong && "font-semibold")}>{share}</td>
    </tr>
  );
}
