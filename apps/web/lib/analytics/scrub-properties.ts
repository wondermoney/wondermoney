/**
 * The last check before any web event leaves the browser (AnalyticsInit's `before_send`).
 * Events name what happened and describe it with fixed values; they never carry a database
 * identifier, an email, an amount, free text or a whole object. Call sites are meant to send
 * nothing of the kind; this drops whatever slips through:
 *
 * - a property named like an identifier (`accountKey`, `budget_key`, `transactionIds`,
 *   `requisition_id`) or like sensitive data (the activation pattern: email, balance, ...);
 * - a property whose value is an object, or an array holding anything but strings, numbers
 *   and booleans (a submitted form, a file);
 * - a string value that holds an email address.
 *
 * PostHog's own properties (`$`-prefixed, `distinct_id`, `token`) are left alone.
 */
const IDENTIFIER_KEY = /(?:^|_)(?:id|ids|key|keys)$|[a-z0-9](?:Id|Ids|Key|Keys)$/u;
const SENSITIVE_KEY =
  /(account_name|balance|email|error_detail|error_message|merchant|password|raw|token)/iu;
const EMAIL_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+/u;
const POSTHOG_KEYS = new Set(["distinct_id", "token"]);

function isPlainValue(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "string") return !EMAIL_VALUE.test(value);
  return typeof value === "number" || typeof value === "boolean";
}

function isAllowedValue(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.every(isPlainValue);
  return isPlainValue(value);
}

export function scrubEventProperties<T extends Record<string, unknown>>(
  properties: T,
): T {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key.startsWith("$") || POSTHOG_KEYS.has(key)) {
      kept[key] = value;
      continue;
    }
    if (IDENTIFIER_KEY.test(key) || SENSITIVE_KEY.test(key)) continue;
    if (!isAllowedValue(value)) continue;
    kept[key] = value;
  }
  return kept as T;
}
