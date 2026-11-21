/**
 * The investor profile guide's worked example (InvestorProfileGuide.astro): the answers the
 * example describes, scored by `scoreInvestorProfile` as the quiz scores them, as figures.
 */
import { Gauge, ShieldCheck, Wallet } from "lucide-react";
import {
  INVESTOR_PROFILE_CHOICES,
  INVESTOR_PROFILE_QUESTIONS,
  scoreInvestorProfile,
} from "@/lib/calculators/investorProfile";
import type { Lang } from "@/lib/routes";
import { formatNumber } from "@/lib/numberFormat";
import { getTranslations } from "@/lib/translations";
import type { GuideFigure } from "./guideBlocks";

/**
 * The worked example's six answers, in question order, as the guide's example sentence gives
 * them: capacity 0, 1 and 1; comfort 2, 2 and 2.
 */
export const INVESTOR_PROFILE_EXAMPLE_ANSWERS = [0, 1, 1, 2, 2, 2] as const;

/** The highest score of a group of three answers. */
const GROUP_MAX = (INVESTOR_PROFILE_QUESTIONS.length / 2) * Math.max(...INVESTOR_PROFILE_CHOICES);

export function investorProfileExampleScore() {
  const score = scoreInvestorProfile(INVESTOR_PROFILE_EXAMPLE_ANSWERS);
  if (!score) throw new Error("Invalid investor profile worked example");
  return score;
}

export function buildInvestorProfileGuide(locale: Lang): { figures: GuideFigure[] } {
  const t = getTranslations(locale);
  const copy = (key: string) => t(`tools.investorProfile.${key}`);
  const score = investorProfileExampleScore();
  const outOf = (value: number) => `${formatNumber(locale, value)} / ${formatNumber(locale, GROUP_MAX)}`;
  const share = (value: number) => (value / GROUP_MAX) * 100;

  return {
    figures: [
      { label: copy("capacityLabel"), value: outOf(score.capacity), icon: Wallet, share: share(score.capacity) },
      { label: copy("comfortLabel"), value: outOf(score.comfort), icon: ShieldCheck, share: share(score.comfort) },
      { label: copy(`results.${score.band}.title`), value: outOf(Math.min(score.capacity, score.comfort)), icon: Gauge },
    ],
  };
}
