/**
 * A goal's progress, 0..100, or null when it cannot be known.
 *
 * The API's `summary.progressPercentage` is the figure: the goal detail page
 * and the debt card already read it. The save-up card used to divide what is
 * available by the target instead, which drifts from the detail page as soon
 * as money is spent from the goal. Available ÷ target stays only as the
 * fallback for a response without the API figure.
 */
export function goalProgress(goal: {
  targetAmount?: number | null;
  summary?: {
    progressPercentage?: number | null;
    availableAmount?: number | null;
  } | null;
}): number | null {
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  const reported = goal.summary?.progressPercentage;
  if (typeof reported === "number" && Number.isFinite(reported)) {
    return clamp(reported);
  }
  const available = goal.summary?.availableAmount;
  const target = goal.targetAmount ?? 0;
  if (typeof available !== "number" || !(target > 0)) return null;
  return clamp((available / target) * 100);
}
