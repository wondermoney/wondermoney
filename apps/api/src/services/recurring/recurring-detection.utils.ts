import { RecurringAmountType, RecurringCadence, RecurringSeriesType } from './recurring-types';

const CADENCE_WINDOWS: { cadence: RecurringCadence; maxDays: number; minDays: number; }[] = [
  { cadence: RecurringCadence.weekly, maxDays: 9, minDays: 5 },
  { cadence: RecurringCadence.biweekly, maxDays: 17, minDays: 11 },
  { cadence: RecurringCadence.monthly, maxDays: 36, minDays: 23 },
  { cadence: RecurringCadence.quarterly, maxDays: 102, minDays: 79 },
  { cadence: RecurringCadence.yearly, maxDays: 385, minDays: 345 },
];

const SUBSCRIPTION_MERCHANT_PATTERNS = [
  /\badobe\b/,
  /\bamazon prime\b/,
  /\bapple (music|one|tv)\b/,
  /\bdeezer\b/,
  /\bdisney(?: plus)?\b/,
  /\bdropbox\b/,
  /\bgoogle one\b/,
  /\bhbo\b/,
  /\bicloud\b/,
  /\bmeo\b/,
  /\bmicrosoft 365\b/,
  /\bnetflix\b/,
  /\bnos\b/,
  /\bspotify\b/,
  /\bvodafone\b/,
] as const;

interface ScoreRecurringCandidateInput {
  amountType: RecurringAmountType;
  hasKnownCadence: boolean;
  hasMerchantKey: boolean;
  hasRecurringFriendlyCategory: boolean;
  occurrenceCount: number;
  seenRecently: boolean;
  userConfirmedSimilar?: boolean;
  userDismissedSimilar?: boolean;
}

export function classifyAmountType(amounts: number[]): RecurringAmountType {
  if (amounts.length === 0) return RecurringAmountType.variable;

  const averageMagnitude = amounts.reduce((sum, amount) => sum + Math.abs(amount), 0) / amounts.length;
  const maxDeviation = Math.max(...amounts.map((amount) => Math.abs(Math.abs(amount) - averageMagnitude)));
  return maxDeviation <= averageMagnitude * 0.1 ? RecurringAmountType.fixed : RecurringAmountType.variable;
}

export function detectCadence(dates: Date[]): null | { cadence: RecurringCadence; confidence: number } {
  if (dates.length < 2) return null;

  const sortedDates = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const deltas = [] as number[];
  for (let i = 1; i < sortedDates.length; i += 1) {
    const currentDate = sortedDates[i];
    const previousDate = sortedDates[i - 1];
    if (!currentDate || !previousDate) continue;
    const deltaDays = (currentDate.getTime() - previousDate.getTime()) / 86400000;
    deltas.push(Math.round(deltaDays));
  }

  for (const { cadence, maxDays, minDays } of CADENCE_WINDOWS) {
    if (deltas.every((delta) => delta >= minDays && delta <= maxDays)) {
      return { cadence, confidence: 95 };
    }
  }

  return null;
}

export function inferRecurringSeriesType(normalizedMerchantKey: string, cadence: RecurringCadence): RecurringSeriesType {
  if (cadence === RecurringCadence.weekly || cadence === RecurringCadence.biweekly) {
    return RecurringSeriesType.bill;
  }

  return SUBSCRIPTION_MERCHANT_PATTERNS.some((pattern) => pattern.test(normalizedMerchantKey))
    ? RecurringSeriesType.subscription
    : RecurringSeriesType.bill;
}

export function normalizeRecurringMerchant(input?: null | string): string {
  if (!input?.trim()) return '';

  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\bp\d+\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scoreRecurringCandidate(input: ScoreRecurringCandidateInput): number {
  let score = 0;
  if (input.occurrenceCount >= 3) score += 25;
  if (input.hasKnownCadence) score += 25;
  if (input.hasMerchantKey) score += 20;
  if (input.amountType === RecurringAmountType.fixed) score += 15;
  if (input.hasRecurringFriendlyCategory) score += 10;
  if (input.seenRecently) score += 5;
  if (input.userConfirmedSimilar) score += 30;
  if (input.userDismissedSimilar) score -= 40;
  return Math.max(0, Math.min(100, score));
}
