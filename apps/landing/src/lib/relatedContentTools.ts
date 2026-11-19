import { toLocalizedPath, type Lang, type ToolRouteId } from "./routes";
import { getToolCatalogEntry } from "./toolsCatalog";
import type { Translate } from "./translations";

/** Link from Learn and Glossary entries that the CMS already associates with these tools. */
const CONTENT_TOOL_LINKS: ReadonlyArray<{
  sources: readonly ToolRouteId[];
  destination: ToolRouteId;
}> = [
  {
    sources: ["toolCompoundInterest"],
    destination: "toolInvestmentReturn",
  },
  {
    sources: ["toolHouseholdBudget", "toolCompoundInterest", "toolInvestmentReturn", "toolSavingsGoal"],
    destination: "toolInflation",
  },
  {
    sources: ["toolCompoundInterest", "toolInvestmentReturn"],
    destination: "toolInvestorProfile",
  },
  {
    sources: ["toolMortgage", "toolEarlyRepayment"],
    destination: "toolMortgageTransfer",
  },
  {
    sources: ["toolMortgage", "toolEarlyRepayment"],
    destination: "toolRateRevision",
  },
  {
    sources: ["toolMortgage", "toolEarlyRepayment", "toolDebtToIncome"],
    destination: "toolPersonalLoan",
  },
  {
    sources: ["toolPersonalLoan", "toolDebtToIncome", "toolHouseholdBudget"],
    destination: "toolCarLoan",
  },
  {
    sources: ["toolTermDeposit", "toolSavingsGoal", "toolCompoundInterest"],
    destination: "toolSavingsCertificates",
  },
  {
    sources: ["toolMortgage", "toolBuyVsRent", "toolHouseholdBudget"],
    destination: "toolPropertyTax",
  },
  {
    sources: ["toolMortgage", "toolBorrowingCapacity", "toolBuyVsRent"],
    destination: "toolPurchaseTaxes",
  },
  {
    sources: ["toolMortgage", "toolBorrowingCapacity", "toolBuyVsRent"],
    destination: "toolYouthMortgage",
  },
  {
    sources: ["toolHouseholdBudget", "toolSavingsRate", "toolDebtToIncome"],
    destination: "toolNetSalary",
  },
  {
    sources: ["toolNetSalary", "toolHouseholdBudget", "toolSavingsGoal"],
    destination: "toolChristmasAllowance",
  },
  {
    sources: ["toolNetSalary", "toolChristmasAllowance", "toolSavingsGoal"],
    destination: "toolHolidayAllowance",
  },
  {
    sources: ["toolNetSalary", "toolHouseholdBudget", "toolBorrowingCapacity"],
    destination: "toolWithholdingTables",
  },
  {
    sources: ["toolNetSalary", "toolEmergencyFund", "toolHouseholdBudget"],
    destination: "toolUnemploymentBenefit",
  },
  {
    sources: ["toolUnemploymentBenefit", "toolEmergencyFund", "toolNetSalary"],
    destination: "toolSickPay",
  },
  {
    sources: ["toolUnemploymentBenefit", "toolNetSalary", "toolEmergencyFund"],
    destination: "toolDismissalCompensation",
  },
  {
    sources: ["toolCarLoan", "toolHouseholdBudget", "toolSavingsGoal"],
    destination: "toolVehicleTax",
  },
  {
    sources: ["toolPurchaseTaxes", "toolPropertyTax", "toolMortgage"],
    destination: "toolPropertyCapitalGains",
  },
  {
    sources: ["toolCompoundInterest", "toolInvestmentReturn", "toolNetSalary"],
    destination: "toolStatePension",
  },
  {
    sources: ["toolCompoundInterest", "toolInvestmentReturn", "toolInvestorProfile"],
    destination: "toolSp500History",
  },
  {
    sources: ["toolMortgage", "toolRateRevision", "toolMortgageTransfer"],
    destination: "toolEuribor",
  },
  {
    sources: ["toolTermDeposit", "toolSavingsCertificates", "toolInflation"],
    destination: "toolDepositRateIndex",
  },
  {
    sources: ["toolTermDeposit", "toolDepositRateIndex", "toolSavingsCertificates"],
    destination: "toolTermDepositOffers",
  },
  {
    sources: ["toolHouseholdBudget", "toolEmergencyFund", "toolInflation"],
    destination: "toolElectricityIndex",
  },
];

export function getRelatedContentTools(
  items: readonly { href: string }[],
  locale: Lang,
  t: Translate,
) {
  const hrefs = new Set(items.map((item) => item.href));

  return CONTENT_TOOL_LINKS.flatMap(({ sources, destination }) => {
    const href = toLocalizedPath(destination, locale);
    if (hrefs.has(href) || !sources.some((source) => hrefs.has(toLocalizedPath(source, locale)))) {
      return [];
    }

    const { key } = getToolCatalogEntry(destination);
    return [{ href, title: t(`tools.${key}.title`), description: "", type: "calculator" as const }];
  });
}
