"use client";

import { useQuery } from "@tanstack/react-query";

/** `GET /v1/instance`: what this server offers. See the API's `controller/instance.ts`. */
export interface InstanceDescription {
  apiVersion: number;
  features: {
    ai: { assistant: boolean; csvMapping: boolean; enrichment: boolean; monthlyStory: boolean; ocr: boolean };
    bankSync: boolean;
    contactForm: boolean;
    email: boolean;
    fileStorage: boolean;
    marketData: boolean;
  };
  minAppVersion: null | string;
  name: string;
  signupMode: "closed" | "invite" | "open";
}

const apiBaseUrl = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function fetchInstance(): Promise<InstanceDescription> {
  const res = await fetch(`${apiBaseUrl()}/v1/instance`);
  if (!res.ok) throw new Error(`GET /v1/instance failed: ${res.status}`);
  return (await res.json()) as InstanceDescription;
}

/**
 * The server's capabilities. Public, and stable for the life of a deploy, so it is fetched once
 * per session. While it loads, `features` is undefined: callers treat an unknown feature as
 * available rather than flash it away.
 */
export function useInstance() {
  return useQuery({
    queryFn: fetchInstance,
    queryKey: ["instance"],
    retry: 1,
    staleTime: Infinity,
  });
}

/** True unless the server has said the feature is off. */
export function useFeature(select: (features: InstanceDescription["features"]) => boolean): boolean {
  const { data } = useInstance();
  return data ? select(data.features) : true;
}
