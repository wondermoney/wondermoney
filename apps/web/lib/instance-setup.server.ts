import "server-only";

import { unstable_rethrow } from "next/navigation";
import { cache } from "react";

import type { InstanceDescription } from "@/lib/api/instance/useInstance";
import { getServerApiUrl } from "@/lib/api/server-api-url";

const TIMEOUT_MS = 2000;

export interface InstanceSetup {
  /** The server's description, when this render asked for it. */
  instance: InstanceDescription | null;
  /** True while this server has never had an account, the demo aside (`GET /v1/instance` `setupRequired`). */
  setupRequired: boolean;
}

/**
 * Once the API has said the server is set up it stays set up (the first account exists for good),
 * so the web server remembers that and stops asking.
 */
let setUp = false;

/**
 * Whether this server still needs its first account, for the sign-in and sign-up pages, which
 * send a visitor to `/setup` while it does, and for the setup page itself.
 *
 * Asked fresh (no fetch cache) until the answer is false: a cached `true` would keep sending
 * people to setup after the first account exists. An unreachable API, an error or an API older
 * than the field all read as set up, so the usual sign-in shows.
 */
export const getInstanceSetup = cache(async (): Promise<InstanceSetup> => {
  if (setUp) return { instance: null, setupRequired: false };
  try {
    const res = await fetch(`${getServerApiUrl()}/v1/instance`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GET /v1/instance failed: ${res.status}`);
    const instance = (await res.json()) as InstanceDescription;
    const setupRequired = instance.setupRequired === true;
    if (!setupRequired) setUp = true;
    return { instance, setupRequired };
  } catch (error) {
    unstable_rethrow(error);
    console.warn("Could not tell whether this server needs setting up", error);
    return { instance: null, setupRequired: false };
  }
});
