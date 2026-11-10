import { useFeature } from "@/lib/api/instance/useInstance";

import { NAVIGATION, type NavigationItem } from "./navigation";

/** The destinations this server offers: Financial Markets needs market data. */
export function useVisibleNavigation(): NavigationItem[] {
  const marketDataAvailable = useFeature((features) => features.marketData);
  return NAVIGATION.filter(
    (item) => item.requires !== "marketData" || marketDataAvailable,
  );
}
