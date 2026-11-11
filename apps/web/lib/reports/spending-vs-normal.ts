import type { SpendingVsNormalRow } from "@/lib/api/reports/types";

/**
 * The diverging scale a spending-vs-normal tile is coloured on.
 *
 * `none` is a category with no usable baseline: it is neutral by definition, never "above
 * normal". `near` is within ±15% of normal, the band an ordinary month sits in.
 */
export type SpendingVsNormalTone =
  | "below"
  | "near"
  | "above"
  | "wellAbove"
  | "none";

/** The ratio bands, as the ratio to normal (`total / normal`). */
export const SPENDING_VS_NORMAL_BANDS = {
  /** At or below this ratio the category is below normal. */
  below: 0.85,
  /** At or above this ratio the category is above normal. */
  above: 1.15,
  /** Above this ratio the category is well above normal. */
  wellAbove: 1.5,
} as const;

export function spendingVsNormalTone(
  ratio: number | null,
): SpendingVsNormalTone {
  if (ratio === null) return "none";
  if (ratio <= SPENDING_VS_NORMAL_BANDS.below) return "below";
  if (ratio <= SPENDING_VS_NORMAL_BANDS.above) return "near";
  if (ratio <= SPENDING_VS_NORMAL_BANDS.wellAbove) return "above";
  return "wellAbove";
}

/**
 * The tile fill. Semantic fills pair with their own `-foreground`, which is what keeps the tile
 * label legible in both themes (DESIGN.md's fill-vs-text rule).
 */
export function spendingVsNormalFill(tone: SpendingVsNormalTone): string {
  switch (tone) {
    case "below":
      return "var(--success)";
    case "above":
      return "var(--warning)";
    case "wellAbove":
      return "var(--destructive)";
    case "near":
    case "none":
      return "var(--muted)";
  }
}

/** The text colour that pairs with {@link spendingVsNormalFill}. */
export function spendingVsNormalTextClass(
  tone: SpendingVsNormalTone,
): string {
  switch (tone) {
    case "below":
      return "text-success-foreground";
    case "above":
      return "text-warning-foreground";
    case "wellAbove":
      return "text-destructive-foreground";
    case "near":
    case "none":
      return "text-foreground";
  }
}

/** The change from normal as a percentage (1.5 → 50); null without a baseline. */
export function spendingVsNormalChange(row: SpendingVsNormalRow): number | null {
  return row.ratio === null ? null : (row.ratio - 1) * 100;
}
