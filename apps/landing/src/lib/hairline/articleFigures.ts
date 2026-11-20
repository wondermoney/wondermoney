/**
 * Which Hairline figure each article and hub card shows.
 *
 * A name in FIGURE_NAMES is a figure a page asks for. A name in PENDING has no
 * file in ./figures yet: the page draws the stand-in (`jar`) and describes the
 * stand-in, so the label always matches the drawing. When a figure lands, drop
 * its file in ./figures/<name>.js and take its name out of PENDING; the test
 * beside this file fails until both are done.
 */

export const FIGURE_NAMES = [
  "jar",
  "envelopes",
  "snowball",
  "eggs",
  "etfbox",
  "inflation",
  "doorchain",
  "taxwedge",
  "scale",
  "timer",
  "containers",
  "booklets",
  "calculator",
  "compass",
  "cardindex",
  "calendar",
  "riskdial",
  "house",
  "deed",
  "car",
  "payslip",
  "easelchart",
  "meter",
  "pump",
  "wallet",
  "safe",
  "deckchair",
] as const;

export type FigureName = (typeof FIGURE_NAMES)[number];

/** Figures not delivered yet. Empty it as figures land. */
export const PENDING: readonly FigureName[] = [];

const STAND_IN: FigureName = "jar";

export type ResolvedFigure = {
  /** The figure file that is drawn. */
  name: FigureName;
  /** The translation key of its accessible description. */
  labelKey: `hairline.labels.${FigureName}`;
};

/** The figure actually drawn for a requested one, and the key of its description. */
export function resolveFigure(requested: FigureName): ResolvedFigure {
  const name = PENDING.includes(requested) ? STAND_IN : requested;
  return { name, labelKey: `hairline.labels.${name}` };
}

/** Learn guides (`src/content/guides`) by slug, English and Portuguese. Guides exist in those two locales only. */
const GUIDE_FIGURES: Readonly<Record<string, FigureName>> = {
  "emergency-fund-guide": "jar",
  "fundo-de-emergencia": "jar",
  "build-monthly-budget": "envelopes",
  "como-criar-orcamento-mensal": "envelopes",
  "debt-payoff-plan": "snowball",
  "plano-para-pagar-dividas": "snowball",
  "diversification-portfolio": "eggs",
  "diversificacao-da-carteira": "eggs",
  "etf-investing-beginners": "etfbox",
  "investir-em-etfs-iniciantes": "etfbox",
  "inflation-real-return": "inflation",
  "inflacao-e-rendimento-real": "inflation",
  "open-banking-safe": "doorchain",
  "open-banking-e-seguranca": "doorchain",
  "tax-planning-investors": "taxwedge",
  "planeamento-fiscal-investidores": "taxwedge",
};

/** A learn guide's subject figure, or undefined for a guide nobody has mapped yet. */
export function figureForGuide(slug: string): FigureName | undefined {
  return GUIDE_FIGURES[slug];
}

/** The standalone articles, by route id, and the product pages their cards link to. */
export const PAGE_FIGURES = {
  pageHowToCalculateNetWorth: "scale",
  pageNetWorthTracker: "scale",
  pagePortfolioTracker: "easelchart",
  guideMoneyCheckin: "timer",
  pageSavingsGuide: "containers",
  learnHub: "booklets",
  glossaryHub: "cardindex",
  monthlyHub: "calendar",
} as const satisfies Record<string, FigureName>;

/** Resources hub cards, by their `destination` (src/lib/resourcesHub.ts). */
export const RESOURCE_CARD_FIGURES: Readonly<Record<string, FigureName>> = {
  guided_start: "compass",
  guides: "booklets",
  glossary: "cardindex",
  monthly: "calendar",
  household_budget: "envelopes",
  emergency_fund: "jar",
  tools: "calculator",
  savings_guide: "containers",
  investor_profile: "riskdial",
};

export function figureForResource(destination: string): FigureName {
  return RESOURCE_CARD_FIGURES[destination] ?? "booklets";
}

/** Calculators whose subject already has a figure; the rest show the calculator. */
const TOOL_FIGURES: Readonly<Record<string, FigureName>> = {
  toolEmergencyFund: "jar",
  toolHouseholdBudget: "envelopes",
  toolInflation: "inflation",
  toolCompoundInterest: "snowball",
  toolSavingsGoal: "containers",
  toolSavingsRate: "jar",
  toolNetWorth: "scale",
  toolDebtToIncome: "scale",
  toolInvestorProfile: "riskdial",
  toolMortgage: "house",
  toolMortgageTransfer: "house",
  toolEarlyRepayment: "house",
  toolYouthMortgage: "house",
  toolBorrowingCapacity: "house",
  toolBuyVsRent: "house",
  toolRateRevision: "house",
  toolPurchaseTaxes: "deed",
  toolPropertyTax: "deed",
  toolPropertyCapitalGains: "deed",
  toolCarLoan: "car",
  toolVehicleTax: "car",
  toolNetSalary: "payslip",
  toolWithholdingTables: "payslip",
  toolChristmasAllowance: "payslip",
  toolHolidayAllowance: "payslip",
  toolUnemploymentBenefit: "payslip",
  toolSickPay: "payslip",
  toolDismissalCompensation: "payslip",
  toolStatePension: "payslip",
  toolSp500History: "easelchart",
  toolInvestmentReturn: "easelchart",
  toolEuribor: "easelchart",
  toolDepositRateIndex: "easelchart",
  toolElectricityIndex: "meter",
  toolFuelPrices: "pump",
  toolFreeBankAccounts: "wallet",
  toolRemuneratedAccounts: "wallet",
  toolPersonalLoan: "wallet",
  toolTermDeposit: "safe",
  toolTermDepositOffers: "safe",
  toolSavingsCertificates: "safe",
  pageFireCalculator: "deckchair",
};

export function figureForTool(routeId: string | undefined): FigureName {
  return (routeId && TOOL_FIGURES[routeId]) || "calculator";
}
