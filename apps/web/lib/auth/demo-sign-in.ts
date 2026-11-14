"use client";

import type { AxiosInstance } from "axios";

import api from "@/lib/api/api";
import { API_ERROR_CODE, getApiErrorCode } from "@/lib/api/errors";
import { isRateLimitError } from "@/lib/api/rate-limit";

/**
 * Why a demo sign-in did not start, as the sign-in page words it:
 * - `unavailable`: the server has no demo (404, the flag is off) or has not set the demo
 *   account up (503 `demo_unavailable`). Trying again will not help.
 * - `rate-limited`: too many demo sign-ins from here (429).
 * - `failed`: anything else, a network error included.
 */
export type DemoSignInFailure = "failed" | "rate-limited" | "unavailable";

/**
 * `POST /v1/auth/demo`: signs the browser in to the shared read-only demo account. The
 * session arrives as the same better-auth cookie a password sign-in sets, so the shared
 * client (`withCredentials`) is what keeps it; the body's copy of the session is for
 * clients without a cookie jar.
 */
export async function startDemoSession(
  apiClient: AxiosInstance = api,
): Promise<void> {
  await apiClient.post("/v1/auth/demo", {});
}

export function demoSignInFailure(error: unknown): DemoSignInFailure {
  if (isRateLimitError(error)) return "rate-limited";
  const status = (error as { response?: { status?: unknown } } | null)?.response
    ?.status;
  if (
    status === 404 ||
    getApiErrorCode(error) === API_ERROR_CODE.DEMO_UNAVAILABLE
  ) {
    return "unavailable";
  }
  return "failed";
}
