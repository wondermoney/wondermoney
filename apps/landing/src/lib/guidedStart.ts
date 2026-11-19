import type { RouteId } from "./routes";

export const GUIDED_GOALS = ["budget", "savings", "investing"] as const;
export const GUIDED_TASKS = ["review", "plan"] as const;
export type GuidedGoal = (typeof GUIDED_GOALS)[number];
export type GuidedTask = (typeof GUIDED_TASKS)[number];

const destinations = {
  budget: { review: "toolNetWorth", plan: "toolHouseholdBudget" },
  savings: { review: "toolSavingsRate", plan: "toolSavingsGoal" },
  investing: { review: "toolInvestmentReturn", plan: "toolCompoundInterest" },
} as const satisfies Record<GuidedGoal, Record<GuidedTask, RouteId>>;

export type GuidedDestination = (typeof destinations)[GuidedGoal][GuidedTask];

export function getGuidedDestination(goal: GuidedGoal, task: GuidedTask): GuidedDestination {
  return destinations[goal][task];
}

// Each position corresponds to the choice number in every translation.
export const LITERACY_QUESTIONS = [
  // https://files.consumerfinance.gov/f/documents/cfpb_well-being_monthly-budget.pdf
  { id: "budget", correct: 0 },
  // https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins/updated
  { id: "fees", correct: 2 },
  // https://www.ecb.europa.eu/ecb-and-you/explainers/tell-me-more/html/what_is_inflation.en.html
  { id: "inflation", correct: 1 },
  // https://www.investor.gov/introduction-investing/getting-started/asset-allocation
  { id: "diversification", correct: 0 },
] as const;

export const LITERACY_CHOICES = [0, 1, 2] as const;
type LiteracyQuestion = (typeof LITERACY_QUESTIONS)[number]["id"];
export type LiteracyChoice = (typeof LITERACY_CHOICES)[number];
export type LiteracyAnswers = Partial<Record<LiteracyQuestion, LiteracyChoice>>;

export function scoreLiteracyQuiz(answers: LiteracyAnswers): number | undefined {
  if (LITERACY_QUESTIONS.some(({ id }) => answers[id] === undefined)) return undefined;
  return LITERACY_QUESTIONS.filter(({ id, correct }) => answers[id] === correct).length;
}
