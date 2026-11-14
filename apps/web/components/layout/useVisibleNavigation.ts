import { useFeature } from "@/lib/api/instance/useInstance";
import { usePreviewFeatures } from "@/lib/api/preview-features/usePreviewFeatures";

import { NAVIGATION, type NavigationItem } from "./navigation";

/**
 * The destinations this server and this person can see: Financial Markets needs
 * market data, and a `preview` destination waits for the preview-features flag.
 */
export function filterVisibleNavigation(
  items: NavigationItem[],
  availability: { marketData: boolean; previewFeatures: boolean },
): NavigationItem[] {
  return items.filter((item) => {
    if (item.requires === "marketData" && !availability.marketData) return false;
    if (item.preview && !availability.previewFeatures) return false;
    return true;
  });
}

export function useVisibleNavigation(): NavigationItem[] {
  const marketDataAvailable = useFeature((features) => features.marketData);
  const previewFeatures = usePreviewFeatures();
  return filterVisibleNavigation(NAVIGATION, {
    marketData: marketDataAvailable,
    previewFeatures,
  });
}
