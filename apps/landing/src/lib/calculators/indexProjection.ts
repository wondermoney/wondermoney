import {
  computeCompoundInterest,
  MAX_AMOUNT,
  MAX_RATE,
  MAX_YEARS,
} from "./compoundInterest";

export const INDEX_PROJECTION_LIMITS = {
  principal: { min: 0, max: MAX_AMOUNT },
  monthlyContribution: { min: 0, max: MAX_AMOUNT },
  annualRate: { min: -MAX_RATE, max: MAX_RATE },
  annualFee: { min: 0, max: 10 },
  years: { min: 0, max: MAX_YEARS },
};

type ProjectionField = keyof typeof INDEX_PROJECTION_LIMITS;
export type IndexProjectionInput = Record<ProjectionField, number>;

export const INDEX_PROJECTION_EXAMPLE: IndexProjectionInput = {
  principal: 10000,
  monthlyContribution: 200,
  annualRate: 6,
  annualFee: 0.25,
  years: 20,
};

export function computeIndexProjection(input: IndexProjectionInput) {
  const fields = Object.keys(INDEX_PROJECTION_LIMITS) as ProjectionField[];
  if (fields.some((field) => Number.isNaN(input[field]))) {
    return { status: "incomplete" } as const;
  }
  if (fields.some((field) => {
    const { min, max } = INDEX_PROJECTION_LIMITS[field];
    return !Number.isFinite(input[field]) || input[field] < min || input[field] > max;
  }) || !Number.isInteger(input.years)) {
    return { status: "outOfRange" } as const;
  }

  // Convert an effective annual return to the nominal percentage the shared engine divides by 12.
  const nominalAnnualRate = (annualFactor: number) =>
    Math.expm1(Math.log(annualFactor) / 12) * 1200;
  const grossFactor = 1 + input.annualRate / 100;
  const netFactor = grossFactor * (1 - input.annualFee / 100);
  const project = (factor: number) => computeCompoundInterest(
    { ...input, annualRate: nominalAnnualRate(factor), inflationRate: 0 },
    { allowNegativeReturn: true },
  ).nominal;

  const gross = project(grossFactor);
  const net = project(netFactor);
  if (!gross || !net) return { status: "tooLarge" } as const;

  return {
    status: "ok",
    contributed: net.contributed,
    beforeFees: gross.finalValue,
    afterFees: net.finalValue,
    feeImpact: gross.finalValue - net.finalValue,
  } as const;
}
