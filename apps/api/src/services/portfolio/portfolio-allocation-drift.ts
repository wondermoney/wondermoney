export interface AssetClassDrift {
  assetClass: string;
  currentPct: number;
  driftPts: number;
  targetPct: number;
}

const SIGNIFICANT_DRIFT_THRESHOLD_PTS = 5;
const MAX_NAMED_UNDERWEIGHT_CLASSES = 2;

export function computeAllocationDrift(
  currentByAssetClass: Record<string, number>,
  targetByAssetClass: Record<string, number>,
): AssetClassDrift[] {
  const assetClasses = new Set([...Object.keys(currentByAssetClass), ...Object.keys(targetByAssetClass)]);

  return Array.from(assetClasses).map((assetClass) => {
    const currentPct = currentByAssetClass[assetClass] ?? 0;
    const targetPct = targetByAssetClass[assetClass] ?? 0;
    return { assetClass, currentPct, driftPts: currentPct - targetPct, targetPct };
  });
}

export function generateGuidanceText(driftRows: AssetClassDrift[]): null | string {
  const underweight = driftRows
    .filter((row) => row.driftPts < -SIGNIFICANT_DRIFT_THRESHOLD_PTS)
    .toSorted((a, b) => a.driftPts - b.driftPts);

  if (underweight.length === 0) return null;

  const named =
    underweight.length <= MAX_NAMED_UNDERWEIGHT_CLASSES
      ? underweight.map((row) => row.assetClass).join(' and ')
      : 'your underweight asset classes';

  return `Directing future contributions toward ${named} could reduce this drift over time.`;
}
