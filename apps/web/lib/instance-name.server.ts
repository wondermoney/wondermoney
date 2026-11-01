import "server-only";

import { cache } from "react";

import { getServerApiUrl } from "@/lib/api/server-api-url";
import {
  DEFAULT_INSTANCE_NAME,
  normalizeInstanceName,
} from "@/lib/instance-name";

/**
 * How long the web server reuses the name before asking the API again. `INSTANCE_NAME` only
 * changes when the API restarts, so a rename shows up within this window without restarting web.
 */
const REVALIDATE_SECONDS = 300;
const TIMEOUT_MS = 2000;

/**
 * The instance name for server rendering (metadata, the layout that hands it to client
 * components). The API owns the setting, so the web container needs no copy of it. Asked over
 * `API_INTERNAL_URL`, cached across requests by the fetch cache and within one by `cache()`. An
 * unreachable API renders as the default name rather than failing the page.
 */
export const getInstanceName = cache(async (): Promise<string> => {
  try {
    const res = await fetch(`${getServerApiUrl()}/v1/instance`, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GET /v1/instance failed: ${res.status}`);
    const body = (await res.json()) as { name?: unknown };
    return normalizeInstanceName(body.name);
  } catch (error) {
    console.warn("Could not read the instance name; using the default", error);
    return DEFAULT_INSTANCE_NAME;
  }
});
