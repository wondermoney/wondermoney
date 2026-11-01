/**
 * Rate-limit (HTTP 429) detection and `Retry-After` parsing.
 *
 * The API answers a throttled request with:
 *   - `Retry-After: <seconds>`
 *   - draft-7 `RateLimit` / `RateLimit-Policy` headers
 *   - body `{ code: "RATE_LIMITED", family, message, retryAfter }`
 *
 * A 429 is not a failure — it is the server asking us to wait. Everything that
 * has to tell those two apart reads this module, so the rule lives in exactly
 * one place: the axios interceptor, the React Query retry policy, and the UI
 * states all call `getRateLimitInfo`.
 *
 * This file is deliberately free of React and of axios types so it can be
 * exercised directly by `node:test`.
 */

export const RATE_LIMITED_ERROR_CODE = "RATE_LIMITED";

/**
 * Used when the response says "too many requests" but gives no usable window.
 * Long enough that a retry is unlikely to be throttled again, short enough that
 * the wait does not read as a dead page.
 */
export const DEFAULT_RATE_LIMIT_RETRY_SECONDS = 30;

/** A `Retry-After` of 0 or a date already in the past still gets a beat. */
export const MIN_RATE_LIMIT_RETRY_SECONDS = 1;

/**
 * A hostile or misconfigured `Retry-After` (`Retry-After: 86400`) must not
 * leave a widget counting down for a day. Past this the countdown is capped and
 * the user gets a manual retry instead.
 */
export const MAX_RATE_LIMIT_RETRY_SECONDS = 300;

export type RateLimitInfo = {
  /** Whole seconds to wait, always within the min/max bounds above. */
  retryAfterSeconds: number;
  retryAfterMs: number;
  /** Which API limiter tripped, when the body says so. */
  family?: string;
  /** The API's own message, for diagnostics — not shown to the user. */
  message?: string;
  /**
   * `false` when nothing in the response carried a usable window and
   * `DEFAULT_RATE_LIMIT_RETRY_SECONDS` was substituted.
   */
  retryAfterKnown: boolean;
};

type ResponseLike = {
  status?: unknown;
  data?: unknown;
  headers?: unknown;
};

type ErrorLike = {
  response?: ResponseLike;
  rateLimit?: RateLimitInfo | null;
};

/**
 * Axios hands back either a plain object or an `AxiosHeaders` instance, and
 * header names are case-insensitive either way.
 */
function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;

  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === "function") {
    try {
      const value: unknown = (getter as (key: string) => unknown).call(
        headers,
        name,
      );
      if (typeof value === "string") return value;
      if (typeof value === "number") return String(value);
    } catch {
      // Fall through to the plain-object scan below.
    }
  }

  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(
    headers as Record<string, unknown>,
  )) {
    if (key.toLowerCase() !== wanted) continue;
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }

  return undefined;
}

function parseNumericSeconds(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  // `Number("")` is 0 and `Number(" 12abc")` is NaN; neither is a delta-seconds
  // header, so match the shape explicitly rather than trusting the coercion.
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return undefined;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** `Retry-After` may also be an HTTP-date rather than delta-seconds. */
function parseHttpDateSeconds(
  value: unknown,
  nowMs: number,
): number | undefined {
  if (typeof value !== "string") return undefined;

  const at = Date.parse(value.trim());
  if (Number.isNaN(at)) return undefined;

  return (at - nowMs) / 1000;
}

/**
 * draft-7 combined header, e.g. `RateLimit: limit=1200, remaining=0, reset=42`.
 * `reset` is seconds until the window refills.
 */
function parseCombinedRateLimitReset(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;

  const match = /(?:^|[;,\s])reset\s*=\s*"?(\d+(?:\.\d+)?)"?/i.exec(value);
  return match ? Number(match[1]) : undefined;
}

function clampRetrySeconds(seconds: number | undefined): number | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;

  const rounded = Math.ceil(seconds);
  if (rounded < MIN_RATE_LIMIT_RETRY_SECONDS)
    return MIN_RATE_LIMIT_RETRY_SECONDS;

  return Math.min(rounded, MAX_RATE_LIMIT_RETRY_SECONDS);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Resolves the wait in the order the API is most likely to be precise:
 * body `retryAfter` → `Retry-After` seconds → `Retry-After` HTTP-date →
 * draft-7 `RateLimit: reset=` → `RateLimit-Reset` → default.
 */
function resolveRetryAfterSeconds(
  response: ResponseLike | undefined,
  nowMs: number,
): { seconds: number; known: boolean } {
  const body = asRecord(response?.data);
  const headers = response?.headers;

  const candidates: (number | undefined)[] = [
    clampRetrySeconds(parseNumericSeconds(body?.retryAfter)),
    clampRetrySeconds(parseNumericSeconds(readHeader(headers, "retry-after"))),
    clampRetrySeconds(
      parseHttpDateSeconds(readHeader(headers, "retry-after"), nowMs),
    ),
    clampRetrySeconds(
      parseCombinedRateLimitReset(readHeader(headers, "ratelimit")),
    ),
    clampRetrySeconds(
      parseNumericSeconds(readHeader(headers, "ratelimit-reset")),
    ),
  ];

  for (const candidate of candidates) {
    if (candidate !== undefined) return { seconds: candidate, known: true };
  }

  return { seconds: DEFAULT_RATE_LIMIT_RETRY_SECONDS, known: false };
}

/**
 * Returns the parsed rate-limit envelope, or `null` when the error is anything
 * else. Accepts an already-normalised error (see the axios interceptor), which
 * keeps a date-based `Retry-After` anchored to when the response arrived rather
 * than to whenever the UI happens to ask.
 */
export function getRateLimitInfo(
  error: unknown,
  nowMs: number = Date.now(),
): RateLimitInfo | null {
  if (!error || typeof error !== "object") return null;

  const normalised = (error as ErrorLike).rateLimit;
  if (normalised) return normalised;

  const response = (error as ErrorLike).response;
  if (!response) return null;

  const status =
    typeof response.status === "number" ? response.status : undefined;
  const body = asRecord(response.data);
  const code = typeof body?.code === "string" ? body.code : undefined;

  if (status !== 429 && code !== RATE_LIMITED_ERROR_CODE) return null;

  const { seconds, known } = resolveRetryAfterSeconds(response, nowMs);

  return {
    retryAfterSeconds: seconds,
    retryAfterMs: seconds * 1000,
    family: typeof body?.family === "string" ? body.family : undefined,
    message: typeof body?.message === "string" ? body.message : undefined,
    retryAfterKnown: known,
  };
}

export function isRateLimitError(error: unknown, nowMs?: number): boolean {
  return getRateLimitInfo(error, nowMs) !== null;
}

/**
 * Attaches the parsed envelope to the error so later readers (React Query's
 * retry policy, an error boundary several seconds after the fact) see the
 * window as it was measured at response time.
 */
export function attachRateLimitInfo<T>(error: T, nowMs?: number): T {
  if (!error || typeof error !== "object") return error;

  const info = getRateLimitInfo(error, nowMs);
  if (!info) return error;

  (error as ErrorLike).rateLimit = info;
  return error;
}

/** Whole seconds left before `resumeAt`, floored at 0. */
export function getSecondsRemaining(
  resumeAt: number | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (typeof resumeAt !== "number" || !Number.isFinite(resumeAt)) return 0;

  return Math.max(0, Math.ceil((resumeAt - nowMs) / 1000));
}
