/**
 * The remunerated accounts guide's worked example for one locale (RemuneratedAccountsGuide.astro):
 * its values and figures, computed by `computeNetInterest` and `projectRow` on the table's own
 * rows, as the table computes them.
 */
import { Coins, PiggyBank, Receipt } from "lucide-react";
import {
  BANK_INTEREST_EXAMPLE_AMOUNT,
  BANK_INTEREST_TAX_RATE,
  computeNetInterest,
  projectRow,
} from "@/lib/calculators/bankAccounts";
import { REMUNERATED_ACCOUNTS } from "@/lib/calculators/data/remuneratedAccounts";
import { formatMoney, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import type { GuideFigure, GuideFlowOperator } from "./guideBlocks";

const find = (id: string) => {
  const account = REMUNERATED_ACCOUNTS.find((item) => item.id === id);
  if (!account) throw new Error(`Unknown account ${id}`);
  return account;
};
const net = (id: string, amount: number) => {
  const outcome = computeNetInterest(find(id), amount);
  if (!outcome.ok) throw new Error("The worked example has an invalid amount");
  return outcome.result;
};

/** The amount of the example's second step, above the capped account's maximum. */
export const REMUNERATED_ACCOUNTS_CAPPED_AMOUNT = 50_000;

/** The worked example's three steps: a plain account, a capped one and one priced by plan. */
export function remuneratedAccountsExample() {
  const amount = BANK_INTEREST_EXAMPLE_AMOUNT;
  const revolut = projectRow(find("revolut-poupanca-acesso-imediato"), amount);
  if (!revolut || revolut.plans.length < 2) throw new Error("The worked example needs the plans");
  return {
    plain: net("bankinter-conta-online", amount),
    capped: net("bankinter-conta-mais-ordenado", REMUNERATED_ACCOUNTS_CAPPED_AMOUNT),
    standard: revolut.plans[0],
    ultra: revolut.plans[revolut.plans.length - 1],
  };
}

export type RemuneratedAccountsGuideContent = {
  values: Record<string, string>;
  flow: GuideFigure[];
  flowOperators: GuideFlowOperator[];
  plans: GuideFigure[];
};

export function buildRemuneratedAccountsGuide(locale: Lang): RemuneratedAccountsGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string, values?: Record<string, string>) => t(`tools.remuneratedAccounts.${key}`, values);
  const guide = (key: string, values?: Record<string, string>) => t(`tools.remuneratedAccounts.guide.${key}`, values);
  const { plain, capped, standard, ultra } = remuneratedAccountsExample();

  const eur = (value: number, decimals = 0) => formatMoney(locale, value, { currency: "EUR", decimals });
  const percent = (value: number) => formatPercent(locale, value, { decimals: 2 });
  const values = {
    amount: eur(BANK_INTEREST_EXAMPLE_AMOUNT),
    product: find("bankinter-conta-online").product,
    bank: find("bankinter-conta-online").entity,
    rate: percent(plain.ratePct),
    gross: eur(plain.gross, 2),
    tax: eur(plain.tax, 2),
    net: eur(plain.net, 2),
    product2: find("bankinter-conta-mais-ordenado").product,
    bank2: find("bankinter-conta-mais-ordenado").entity,
    rate2: percent(capped.ratePct),
    cap: eur(find("bankinter-conta-mais-ordenado").maximum ?? 0),
    amount2: eur(REMUNERATED_ACCOUNTS_CAPPED_AMOUNT),
    gross2: eur(capped.gross, 2),
    net2: eur(capped.net, 2),
    product3: find("revolut-poupanca-acesso-imediato").product,
    bank3: find("revolut-poupanca-acesso-imediato").entity,
    low: percent(find("revolut-poupanca-acesso-imediato").tanbMin),
    high: percent(find("revolut-poupanca-acesso-imediato").tanbMax),
    standardNet: eur(standard.result.net, 2),
    ultraFees: eur(ultra.result.fees, 2),
    ultraNet: eur(ultra.result.net, 2),
  };

  const flow: GuideFigure[] = [
    {
      label: guide("example.figures.gross"),
      value: values.gross,
      icon: Coins,
      detail: `${values.amount} × ${values.rate}`,
    },
    { label: guide("example.figures.tax", { tax: String(BANK_INTEREST_TAX_RATE) }), value: values.tax, icon: Receipt },
    { label: guide("example.figures.net"), value: values.net, icon: PiggyBank, tone: "positive" },
  ];

  const planFigure = ({ plan, result }: typeof standard): GuideFigure => ({
    label: plan.name,
    value: eur(result.net, 2),
    detail: `${percent(plan.ratePct)} · ${
      plan.monthlyFee === 0 ? tool("plans.noFee") : tool("plans.fee", { fee: eur(plan.monthlyFee, 2) })
    }`,
  });

  return { values, flow, flowOperators: ["−", "="], plans: [planFigure(standard), planFigure(ultra)] };
}
