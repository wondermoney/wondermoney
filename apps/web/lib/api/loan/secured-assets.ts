import type { QueryClient } from "@tanstack/react-query";

/**
 * An asset a loan is secured against shows the loan's outstanding principal as its
 * linked debt and equity, so anything that links a loan or moves its balance refreshes
 * the assets too. Every asset page, since the link may have moved from one to another.
 */
export function invalidateSecuredAssets(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["manual-assets"] }),
    queryClient.invalidateQueries({ queryKey: ["manual-asset"] }),
  ]);
}
