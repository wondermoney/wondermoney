/**
 * The content of the salary guides for one locale: net salary (NetSalaryGuide.astro), the
 * Christmas and holiday allowances (AllowanceGuide.astro) and the withholding tables
 * (WithholdingTablesGuide.astro). The worked examples' figures come from `computeNetSalary`
 * and `computeAllowance` on the examples the calculators start from; the method notes are
 * the guides' own strings under a term each.
 */
import { Landmark, Receipt, ShieldCheck, Wallet } from "lucide-react";
import {
  ALLOWANCE_EXAMPLE,
  HOLIDAY_HIRING_YEAR_EXAMPLE,
  computeAllowance,
  type AllowanceKind,
} from "@/lib/calculators/allowance";
import { NET_SALARY_EXAMPLE, computeNetSalary } from "@/lib/calculators/payroll";
import { formatMoney } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
  operator,
  variable,
  type GuideFigure,
  type GuideFlowOperator,
  type GuideFormulaLine,
  type GuideTerm,
} from "./guideBlocks";

const centsToMoney = (locale: Lang) => (cents: number) => formatMoney(locale, cents / 100, { decimals: 2 });

export type SalaryExampleContent = {
  /** Values for the example's paragraph. */
  values: Record<string, string>;
  /** Gross − withholding − Social Security = net. */
  flow: GuideFigure[];
  flowOperators: GuideFlowOperator[];
  notes: GuideTerm[];
};

export function buildNetSalaryGuide(locale: Lang): SalaryExampleContent {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.netSalary.${key}`);
  const guide = (key: string) => t(`tools.netSalary.guide.${key}`);
  const example = computeNetSalary(NET_SALARY_EXAMPLE);
  if (!example.ok) throw new Error("Invalid net salary worked example");

  const money = centsToMoney(locale);
  const { monthly, allowancePayment, annual } = example.result;
  const values = {
    gross: formatMoney(locale, NET_SALARY_EXAMPLE.grossMonthly, { decimals: 0 }),
    withholding: money(monthly.withholdingCents),
    socialSecurity: money(monthly.socialSecurityCents),
    meal: money(monthly.mealAllowanceCents),
    net: money(monthly.netCents),
    allowanceNet: money(allowancePayment?.netCents ?? 0),
    annual: money(annual.netCents),
  };

  const flow: GuideFigure[] = [
    { label: tool("fields.grossMonthly"), value: values.gross, icon: Wallet },
    { label: tool("result.withholding"), value: values.withholding, icon: Landmark },
    { label: tool("result.socialSecurity"), value: values.socialSecurity, icon: ShieldCheck },
    {
      label: tool("result.netMonthly"),
      value: values.net,
      icon: Receipt,
      // The meal allowance (in the paragraph above) reaches the account on top of the salary.
      detail: `+ ${values.meal}`,
    },
  ];

  const notes: GuideTerm[] = [
    { term: tool("result.withholding"), body: guide("methodWithholding") },
    { term: tool("result.socialSecurity"), body: guide("methodSocialSecurity") },
    { term: tool("fields.mealGroup"), body: guide("methodMeal") },
    { term: tool("fields.allowances"), body: guide("methodAllowances") },
    { term: guide("methodBudgetTerm"), body: guide("methodBudget") },
  ];

  return { values, flow, flowOperators: ["−", "−", "="], notes };
}

export function buildAllowanceGuide(locale: Lang, kind: AllowanceKind): SalaryExampleContent {
  const t = getTranslations(locale);
  const page = (key: string) => t(`tools.${kind}Allowance.${key}`);
  const shared = (key: string) => t(`tools.allowance.${key}`);
  const input = kind === "christmas" ? ALLOWANCE_EXAMPLE : HOLIDAY_HIRING_YEAR_EXAMPLE;
  const example = computeAllowance(input);
  if (!example.ok) throw new Error("Invalid allowance worked example");

  const money = centsToMoney(locale);
  const { total, holidayDays } = example.result;
  const values = {
    salary: formatMoney(locale, input.grossMonthly, { decimals: 0 }),
    days: String(holidayDays ?? 0),
    gross: money(total.grossCents),
    withholding: money(total.withholdingCents),
    socialSecurity: money(total.socialSecurityCents),
    net: money(total.netCents),
  };

  const flow: GuideFigure[] = [
    { label: shared("result.gross"), value: values.gross, icon: Wallet },
    { label: shared("result.withholding"), value: values.withholding, icon: Landmark },
    { label: shared("result.socialSecurity"), value: values.socialSecurity, icon: ShieldCheck },
    { label: shared("result.netAllowance"), value: values.net, icon: Receipt },
  ];

  const notes: GuideTerm[] = [
    { term: page("shortName"), body: page("guide.ruleAmount") },
    { term: shared("guide.hiringYearTerm"), body: page("guide.ruleHiringYear") },
    { term: shared("result.withholding"), body: shared("guide.methodWithholding") },
    { term: shared("guide.twelfthsTerm"), body: shared("guide.methodTwelfths") },
    { term: shared("result.socialSecurity"), body: shared("guide.methodSocialSecurity") },
    { term: shared("guide.planTerm"), body: page("guide.methodPlan") },
  ];

  return { values, flow, flowOperators: ["−", "−", "="], notes };
}

/** Stable ids of the withholding tables notes the formula links to. */
export const WITHHOLDING_TABLES_GUIDE_IDS = {
  transition: "withholding-tables-note-transition",
  dependants: "withholding-tables-note-dependants",
  tables: "withholding-tables-note-tables",
} as const;

export function buildWithholdingTablesGuide(locale: Lang): { formulas: GuideFormulaLine[]; notes: GuideTerm[] } {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.withholdingTables.${key}`);
  const guide = (key: string) => t(`tools.withholdingTables.guide.${key}`);
  const ids = WITHHOLDING_TABLES_GUIDE_IDS;

  const formulas: GuideFormulaLine[] = [
    {
      result: variable(tool("result.withholding")),
      expression: [
        variable(tool("fields.remuneration")),
        operator("×"),
        variable(tool("columns.rate"), ids.dependants),
        operator("−"),
        variable(tool("columns.parcela"), ids.transition),
        operator("−"),
        variable(tool("fields.dependants"), ids.dependants),
        operator("×"),
        variable(guide("formulaPerDependant"), ids.dependants),
      ],
    },
  ];

  const notes: GuideTerm[] = [
    { term: guide("howTransitionTerm"), body: guide("howTransition"), id: ids.transition },
    { term: tool("fields.dependants"), body: guide("howDependants"), id: ids.dependants },
    { term: tool("fields.table"), body: guide("howTables"), id: ids.tables },
  ];

  return { formulas, notes };
}
