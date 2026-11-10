import { z } from "zod";

// v2: the relaunch message ("now free and open source"), shown again to
// visitors who dismissed the v1 "sign-ups are paused" notice.
export const PIVOT_BANNER_STORAGE_KEY = "wondermoney.pivotBanner.v2";

const PivotBannerDismissalSchema = z.strictObject({
  version: z.literal("pivot-banner.v2"),
  dismissedAt: z.number().int().nonnegative(),
});

export type PivotBannerDismissal = z.infer<typeof PivotBannerDismissalSchema>;

export function readPivotBannerDismissed(storage: Storage): boolean {
  try {
    const serialized = storage.getItem(PIVOT_BANNER_STORAGE_KEY);
    if (!serialized) return false;

    const parsed = PivotBannerDismissalSchema.safeParse(JSON.parse(serialized));
    return parsed.success;
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
}

export function writePivotBannerDismissed(
  storage: Storage,
  now: () => number = () => Math.floor(Date.now() / 1_000),
): boolean {
  const dismissal: PivotBannerDismissal = {
    version: "pivot-banner.v2",
    dismissedAt: now(),
  };

  try {
    storage.setItem(PIVOT_BANNER_STORAGE_KEY, JSON.stringify(dismissal));
    return true;
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
}
