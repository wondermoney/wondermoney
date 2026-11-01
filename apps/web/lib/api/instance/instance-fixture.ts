import { QueryClient } from "@tanstack/react-query";

import type { InstanceDescription } from "./useInstance";

/** Every optional server feature on, with `overrides` merged over the top. */
export function instanceFeatures(
  overrides: Partial<InstanceDescription["features"]> = {},
): InstanceDescription["features"] {
  return {
    ai: { assistant: true, csvMapping: true, enrichment: true, monthlyStory: true, ocr: true },
    bankSync: true,
    contactForm: true,
    email: true,
    feedback: true,
    fileStorage: true,
    googleSignIn: true,
    marketData: true,
    ...overrides,
  };
}

/** A query client that already holds `/v1/instance`, so nothing is fetched in tests. */
export function queryClientWithInstance(
  features: InstanceDescription["features"] = instanceFeatures(),
  overrides: Partial<Omit<InstanceDescription, "features">> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<InstanceDescription>(["instance"], {
    apiVersion: 1,
    features,
    minAppVersion: null,
    name: "Test instance",
    signupMode: "open",
    supportEmail: "help@example.com",
    ...overrides,
  });
  return client;
}
