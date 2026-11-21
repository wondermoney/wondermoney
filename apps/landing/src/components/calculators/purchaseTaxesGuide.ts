/**
 * The IMT and stamp duty guide's content for one locale (PurchaseTaxesGuide.astro): the worked
 * example's values and figures, the method's formulas with the notes they link to, the IMT
 * table and the assumptions. Every figure comes from `computePurchaseTaxes` on the example the
 * calculator starts from, and the table and rates from the same module.
 */
import { Landmark, Receipt, Stamp } from "lucide-react";
import {
  PURCHASE_TAXES_EXAMPLE,
  PURCHASE_TAXES_TABLE,
  STAMP_LOAN_BP,
  STAMP_PURCHASE_BP,
  YOUNG_LIMITS,
  computePurchaseTaxes,
  imtBands,
  ownPermanentExemptionLimit,
} from "@/lib/calculators/purchaseTaxes";
import { formatMoney, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import { call, number, operator, variable, type GuideFigure, type GuideFormulaLine, type GuideTerm } from "./guideBlocks";

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const PURCHASE_TAXES_GUIDE_IDS = {
  base: "purchase-taxes-note-base",
  imt: "purchase-taxes-note-imt",
  stamp: "purchase-taxes-note-stamp",
  rounding: "purchase-taxes-note-rounding",
  scope: "purchase-taxes-note-scope",
  young: "purchase-taxes-note-young",
  loan: "purchase-taxes-note-loan",
  unsupported: "purchase-taxes-note-unsupported",
  islands: "purchase-taxes-note-islands",
  table: "purchase-taxes-table",
} as const;

export function buildPurchaseTaxesGuide(locale: Lang) {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.purchaseTaxes.${key}`);
  const guide = (key: string, values?: Record<string, string>) => t(`tools.purchaseTaxes.guide.${key}`, values);
  const ids = PURCHASE_TAXES_GUIDE_IDS;

  const example = computePurchaseTaxes(PURCHASE_TAXES_EXAMPLE);
  if (!example.ok) throw new Error("Invalid purchase taxes worked example");
  const { price, loan } = PURCHASE_TAXES_EXAMPLE;
  const { imt, stampPurchase, stampLoan, total } = example.result;
  const money = (value: number, decimals = 0) => formatMoney(locale, value, { decimals });
  const young = YOUNG_LIMITS("mainland");
  const values = {
    price: money(price),
    loan: money(loan),
    imt: money(imt, 2),
    stampPurchase: money(stampPurchase, 2),
    stampLoan: money(stampLoan, 2),
    total: money(total, 2),
    year: String(PURCHASE_TAXES_TABLE.year),
    date: PURCHASE_TAXES_TABLE.reviewedOn,
    exempt: money(ownPermanentExemptionLimit("mainland")),
    youngFull: money(young.full),
    youngPartial: money(young.partial),
  };

  const rate = (bp: number) => formatPercent(locale, bp / 100, { decimals: bp % 100 ? 1 : 0 });
  const rows = imtBands("ownPermanent", "mainland").map((band) => ({
    limit: Number.isFinite(band.upTo) ? money(band.upTo) : guide("tableAbove"),
    rate: rate(band.rateBp),
    deduct: band.deductCents ? money(band.deductCents / 100, 2) : "-",
  }));

  // Each tax, its share of the bill, and the bill.
  const share = (value: number) => Math.round((value / total) * 1000) / 10;
  const taxes: GuideFigure[] = [
    { label: tool("result.imt"), value: values.imt, amount: imt, icon: Landmark },
    { label: tool("result.stampPurchase"), value: values.stampPurchase, amount: stampPurchase, icon: Stamp },
    { label: tool("result.stampLoan"), value: values.stampLoan, amount: stampLoan, icon: Stamp },
  ].map(({ amount, ...figure }) => ({ ...figure, share: share(amount), shareLabel: formatPercent(locale, share(amount)) }));
  taxes.push({ label: tool("result.total"), value: values.total, icon: Receipt });

  const base = () => variable(tool("result.reference"), ids.base);
  const formulas: GuideFormulaLine[] = [
    {
      result: base(),
      expression: [call("max", [variable(tool("fields.price"), ids.base)], [variable(guide("labels.vpt"), ids.base)])],
    },
    {
      result: variable(tool("result.imt"), ids.imt),
      expression: [
        base(),
        operator("×"),
        variable(guide("tableRate"), ids.table),
        operator("−"),
        variable(guide("tableDeduct"), ids.table),
      ],
    },
    {
      result: variable(guide("labels.stampPurchase"), ids.stamp),
      expression: [base(), operator("×"), number(rate(STAMP_PURCHASE_BP))],
    },
    {
      result: variable(guide("labels.stampLoan"), ids.loan),
      expression: [variable(tool("fields.loan"), ids.loan), operator("×"), number(rate(STAMP_LOAN_BP))],
    },
    {
      result: variable(tool("result.total"), ids.rounding),
      expression: [
        variable(tool("result.imt"), ids.imt),
        operator("+"),
        variable(guide("labels.stampPurchase"), ids.stamp),
        operator("+"),
        variable(guide("labels.stampLoan"), ids.loan),
      ],
    },
  ];

  const note = (key: keyof typeof ids, textKey: string): GuideTerm => ({
    term: guide(`terms.${key}`),
    body: guide(textKey, values),
    id: ids[key],
  });
  const notes: GuideTerm[] = [
    note("base", "methodBase"),
    note("imt", "methodImt"),
    note("stamp", "methodStamp"),
    note("rounding", "methodRounding"),
  ];
  const assumptions: GuideTerm[] = [
    note("scope", "assumptionScope"),
    note("young", "assumptionYoung"),
    note("loan", "assumptionLoan"),
    { term: guide("assumptionUnsupportedTerm"), body: guide("assumptionUnsupportedBody"), id: ids.unsupported },
    note("islands", "assumptionIslands"),
  ];

  return { values, rows, taxes, formulas, notes, assumptions };
}
