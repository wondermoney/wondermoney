/**
 * The broker fees guide's content for one locale (BrokerFeesGuide.astro): the worked example's
 * values and figures, computed by `brokerYearlyCost` for the occasional stock buyer as the table
 * computes each broker, and the method's steps as a term list.
 */
import { ArrowLeftRight, ReceiptText, ShoppingCart, Vault } from "lucide-react";
import {
  BROKER_FEES,
  BROKER_FEES_ASSUMPTIONS,
  BROKER_FEES_REVIEWED,
  SCENARIO_PROFILES,
  brokerYearlyCost,
} from "@/lib/calculators/brokerFees";
import { createFeeFormat, formatCheckedDate } from "@/lib/calculators/brokerFeesFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import type { GuideFigure, GuideFlowOperator, GuideTerm } from "./guideBlocks";

/** The two brokers the worked example walks through: a Portuguese bank with stamp duty and VAT, and an online broker. */
export const BROKER_FEES_EXAMPLE_IDS = ["banco-best", "ibkr"] as const;

const find = (id: string) => {
  const broker = BROKER_FEES.find((item) => item.id === id);
  if (!broker) throw new Error(`Unknown broker ${id}`);
  return broker;
};

export function brokerFeesExample() {
  const profile = SCENARIO_PROFILES.occasionalStocks;
  const bank = find(BROKER_FEES_EXAMPLE_IDS[0]);
  const online = find(BROKER_FEES_EXAMPLE_IDS[1]);
  if (!bank.usStock || !online.usStock || bank.fxPct === null || online.fxPct === null || !bank.custody || !online.custody)
    throw new Error("The worked example needs published US stock, FX and custody fees");
  return {
    profile,
    bank: { broker: bank, cost: brokerYearlyCost(bank, profile), usStock: bank.usStock, fxPct: bank.fxPct, custody: bank.custody },
    online: { broker: online, cost: brokerYearlyCost(online, profile), usStock: online.usStock, fxPct: online.fxPct, custody: online.custody },
  };
}

export type BrokerFeesGuideContent = {
  values: Record<string, string>;
  bankFlow: GuideFigure[];
  onlineFlow: GuideFigure[];
  flowOperators: GuideFlowOperator[];
  steps: GuideTerm[];
  /** The last step, a sentence without a term. */
  stepsNote: string;
};

export function buildBrokerFeesGuide(locale: Lang): BrokerFeesGuideContent {
  const t = getTranslations(locale);
  const guide = (key: string, values?: Record<string, string>) => t(`tools.brokerFees.guide.${key}`, values);
  const format = createFeeFormat(t, locale);
  const { profile, bank, online } = brokerFeesExample();

  const values = {
    count: String(profile.trades),
    amount: format.money(profile.tradeAmount),
    portfolio: format.money(profile.portfolio),
    converted: format.money(profile.trades * profile.tradeAmount),
    bank: bank.broker.name,
    bankFormula: format.orderFee(bank.usStock),
    bankTrading: format.eur2(bank.cost.trading),
    bankFx: format.percent(bank.fxPct),
    bankFxTotal: format.eur2(bank.cost.fx),
    bankCustodyFormula: format.custody(bank.custody),
    bankCustody: format.eur2(bank.cost.custody),
    bankStampDuty: format.eur2(bank.cost.taxes.find((tax) => tax.kind === "stampDuty")?.amount ?? 0),
    bankVat: format.eur2(bank.cost.taxes.find((tax) => tax.kind === "vat")?.amount ?? 0),
    bankTotal: format.eur2(bank.cost.total),
    online: online.broker.name,
    onlineFormula: format.orderFee(online.usStock),
    onlineTrading: format.eur2(online.cost.trading),
    onlineFx: format.percent(online.fxPct),
    onlineFxTotal: format.eur2(online.cost.fx),
    onlineCustody: format.eur2(online.cost.custody),
    onlineTotal: format.eur2(online.cost.total),
    rate: format.number(BROKER_FEES_ASSUMPTIONS.eurUsd),
    date: formatCheckedDate(locale, BROKER_FEES_REVIEWED),
  };

  // The method's own step names label the parts of each year's cost.
  const flow = (side: "bank" | "online"): GuideFigure[] => [
    { label: guide("method.steps.aTerm"), value: values[`${side}Trading`], icon: ShoppingCart, detail: values[`${side}Formula`] },
    { label: guide("method.steps.cTerm"), value: values[`${side}FxTotal`], icon: ArrowLeftRight, detail: values[`${side}Fx`] },
    { label: guide("method.steps.dTerm"), value: values[`${side}Custody`], icon: Vault },
    { label: guide("example.figures.total"), value: values[`${side}Total`], icon: ReceiptText },
  ];

  const step = (key: string): GuideTerm => ({
    term: guide(`method.steps.${key}Term`),
    body: guide(`method.steps.${key}Body`, values),
  });

  return {
    values,
    bankFlow: flow("bank"),
    onlineFlow: flow("online"),
    flowOperators: ["+", "+", "="],
    steps: ["a", "b", "c", "d", "e"].map(step),
    stepsNote: guide("method.steps.f", values),
  };
}
