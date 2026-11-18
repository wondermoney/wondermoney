export const INVESTOR_PROFILE_QUESTIONS = [
  "horizon",
  "flexibility",
  "cashBuffer",
  "drop",
  "fluctuations",
  "tradeoff",
] as const;

export const INVESTOR_PROFILE_CHOICES = [0, 1, 2] as const;

export type InvestorProfileBand = "lower" | "middle" | "higher";

function getBand(score: number): InvestorProfileBand {
  if (score <= 2) return "lower";
  if (score <= 4) return "middle";
  return "higher";
}

export function scoreInvestorProfile(answers: readonly unknown[]) {
  if (answers.length !== INVESTOR_PROFILE_QUESTIONS.length) return null;

  const scores = Array.from(answers);
  if (!scores.every((score) => score === 0 || score === 1 || score === 2)) {
    return null;
  }

  const [horizon, flexibility, cashBuffer, drop, fluctuations, tradeoff] = scores;
  const capacity = horizon + flexibility + cashBuffer;
  const comfort = drop + fluctuations + tradeoff;

  return { capacity, comfort, band: getBand(Math.min(capacity, comfort)) };
}
