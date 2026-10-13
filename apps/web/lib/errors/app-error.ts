import { isRateLimitError } from "@/lib/api/rate-limit";

interface AxiosLikeError {
  response?: {
    status?: unknown;
  };
}

export type AppErrorCategory =
  | "rate-limit"
  | "auth"
  | "not-found"
  | "service"
  | "network"
  | "unknown";

export function getErrorStatusCode(error: unknown): number | undefined {
  const status = (error as AxiosLikeError | undefined)?.response?.status;

  return typeof status === "number" ? status : undefined;
}

export function classifyAppError(error: unknown): AppErrorCategory {
  const status = getErrorStatusCode(error);

  // Body code as well as status: a proxy can rewrite the status, and an SSR
  // failure re-thrown to the error boundary may only carry the envelope.
  if (status === 429 || isRateLimitError(error)) return "rate-limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not-found";
  if (typeof status === "number" && status >= 500) return "service";

  const message = error instanceof Error ? error.message : undefined;
  if (
    typeof message === "string" &&
    /(?:network error|failed to fetch|fetch failed)/i.test(message)
  ) {
    return "network";
  }

  return "unknown";
}
