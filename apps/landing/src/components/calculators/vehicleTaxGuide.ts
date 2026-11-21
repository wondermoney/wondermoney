/**
 * The IUC guide's content for one locale (VehicleTaxGuide.astro): the worked example's values
 * and figures, the method's formulas with the notes they link to, the scope and the
 * assumptions. Every figure comes from `computeVehicleTax` on the example the calculator
 * starts from.
 */
import { Fuel, Gauge, Receipt, X } from "lucide-react";
import { IUC_TABLES, VEHICLE_TAX_EXAMPLE, computeVehicleTax } from "@/lib/calculators/vehicleTax";
import { formatMoney, formatNumber } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
  fraction,
  group,
  number,
  operator,
  variable,
  type GuideFigure,
  type GuideFormulaLine,
  type GuideTerm,
} from "./guideBlocks";

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const VEHICLE_TAX_GUIDE_IDS = {
  categoryA: "vehicle-tax-note-category-a",
  categoryB: "vehicle-tax-note-category-b",
  additional: "vehicle-tax-note-additional",
  diesel: "vehicle-tax-note-diesel",
  payment: "vehicle-tax-note-payment",
  budget: "vehicle-tax-note-budget",
  year: "vehicle-tax-note-year",
  paymentRule: "vehicle-tax-note-payment-rule",
  educational: "vehicle-tax-note-educational",
} as const;

export function buildVehicleTaxGuide(locale: Lang) {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.vehicleTax.${key}`);
  const guide = (key: string, values?: Record<string, string>) => t(`tools.vehicleTax.guide.${key}`, values);
  const ids = VEHICLE_TAX_GUIDE_IDS;

  const example = computeVehicleTax(VEHICLE_TAX_EXAMPLE);
  if (!example.ok) throw new Error("Invalid vehicle tax worked example");
  const { baseTax, additionalTax, coefficient, dieselSurcharge, annualTax, monthlyProvision } = example.result;
  if (additionalTax !== 0) throw new Error("The IUC worked example should have no additional rate");

  const money = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const values = {
    cc: String(VEHICLE_TAX_EXAMPLE.cc),
    co2: String(VEHICLE_TAX_EXAMPLE.co2),
    year: String(VEHICLE_TAX_EXAMPLE.year),
    tax: money(annualTax),
    monthly: money(monthlyProvision),
    taxYear: String(IUC_TABLES.taxYear),
    reviewed: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(IUC_TABLES.reviewed)),
    law: IUC_TABLES.law,
  };

  // Category B: the engine size and CO2 rates times the year's coefficient, plus the diesel
  // surcharge, which the coefficient does not multiply.
  const tax: GuideFigure[] = [
    { label: tool("result.baseTax"), value: money(baseTax), icon: Gauge },
    { label: tool("result.coefficient"), value: `×${formatNumber(locale, coefficient, 2)}`, icon: X },
    { label: guide("labels.diesel"), value: money(dieselSurcharge), icon: Fuel },
    { label: tool("result.annualTax"), value: money(annualTax), icon: Receipt },
  ];

  const annual = () => variable(tool("result.annualTax"), ids.categoryB);
  const formulas: GuideFormulaLine[] = [
    {
      result: annual(),
      expression: [
        group([
          variable(guide("labels.engineRate"), ids.categoryB),
          operator("+"),
          variable(guide("labels.co2Rate"), ids.categoryB),
          operator("+"),
          variable(tool("result.additionalTax"), ids.additional),
        ]),
        operator("×"),
        variable(tool("result.coefficient"), ids.categoryB),
        operator("+"),
        variable(guide("labels.diesel"), ids.diesel),
      ],
    },
    {
      result: variable(guide("labels.provision"), ids.budget),
      expression: [fraction([annual()], [number(formatNumber(locale, 12))])],
    },
  ];

  const split = (key: string, id: string): GuideTerm => ({
    term: guide(`${key}Term`),
    body: guide(`${key}Body`, values),
    id,
  });
  const note = (key: keyof typeof ids, textKey: string): GuideTerm => ({
    term: guide(`terms.${key}`),
    body: guide(textKey, values),
    id: ids[key],
  });
  const notes: GuideTerm[] = [
    split("methodA", ids.categoryA),
    split("methodB", ids.categoryB),
    note("additional", "methodAdditional"),
    note("diesel", "methodDiesel"),
    note("payment", "methodPayment"),
    note("budget", "methodBudget"),
  ];
  const scope: GuideTerm[] = [
    { term: guide("scopeSupportedTerm"), body: guide("scopeSupportedBody") },
    { term: guide("scopeUnsupportedTerm"), body: guide("scopeUnsupportedBody") },
  ];
  const assumptions: GuideTerm[] = [
    note("year", "assumptionYear"),
    note("paymentRule", "assumptionPayment"),
    note("educational", "assumptionEducational"),
  ];

  return { values, tax, formulas, notes, scope, assumptions };
}
