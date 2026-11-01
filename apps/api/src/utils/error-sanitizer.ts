const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS = [
  /api[-_]?key/i,
  /authorization/i,
  /access[-_]?token/i,
  /refresh[-_]?token/i,
  /card(number)?/i,
  /captcha/i,
  /cookie/i,
  /credit[-_]?card/i,
  /cvv/i,
  /email/i,
  /iban/i,
  /account.*id/i,
  /billing.*id/i,
  /vat/i,
  /password/i,
  /private[-_]?key/i,
  /secret/i,
  /token/i,
];

const REDACTED_KEYS = ['authorization', 'cookie', 'apiKey', 'api_key', 'apikey', 'creditCard', 'cvv', 'email', 'iban', 'account', 'accountId', 'accountNumber', 'billingId', 'captcha', 'password', 'privateKey', 'secret', 'token', 'vat'] as const;

const SAFE_QUERY_KEYS = new Set(['direction', 'limit', 'offset', 'order', 'page', 'sort']);

export function normalizeRequestPath(path: string): string {
  const withoutOrigin = path.replace(/^https?:\/\/[^/]+/i, '');
  const withoutQuery = withoutOrigin.split('?')[0] ?? withoutOrigin;
  return withoutQuery.replace(/\/+$/, '') || '/';
}

export function redactSensitiveData<T>(value: T): T {
  return redactValue(value, 0) as T;
}

export function sanitizeErrorParams(params: unknown): unknown {
  return sanitizeUnknown(params);
}

export function sanitizeErrorQuery(query: unknown): unknown {
  return sanitizeUnknown(query);
}

export function sanitizeErrorRequestBody(path: string, body: unknown): unknown {
  if (isAssistantChatPath(path)) return sanitizeAssistantChatBody(body);
  return summarizeRedactedBody(body);
}

export function sanitizeErrorUrl(url: string): string {
  const strippedPath = stripPathIds(url);
  const [, search = ''] = url.split('?');
  if (!search) return strippedPath;
  const params = new URLSearchParams(search);
  for (const key of params.keys()) {
    if (normalizeRequestPath(url) === '/v1/banking/bank/connection_callback' || isSensitiveKey(key)) params.set(key, REDACTED);
  }
  const sanitizedSearch = params.toString();
  return sanitizedSearch ? `${strippedPath}?${sanitizedSearch}` : strippedPath;
}

export function sanitizeRequestForLogging(path: string, request: { body?: unknown; cookies?: unknown; data?: unknown; headers?: Record<string, unknown>; query?: unknown; }): Record<string, unknown> {
  return {
    body: sanitizeErrorRequestBody(path, request.body),
    cookies: REDACTED,
    data: sanitizeErrorRequestBody(path, request.data ?? request.body),
    headers: sanitizeHeaders(request.headers),
    query: sanitizeQuery(request.query),
  };
}

function getMessageRole(message: unknown): unknown {
  if (!message || typeof message !== 'object') return undefined;
  return (message as { role?: unknown }).role;
}

function isAssistantChatPath(path: string): boolean {
  return normalizeRequestPath(path) === '/v1/assistant/chat';
}

function isSafeScalar(value: unknown): value is boolean | number | string {
  return ['boolean', 'number', 'string'].includes(typeof value);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function redactValue(value: unknown, depth: number): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (depth > 20) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  const sanitized = {} as Record<string, unknown>;
  for (const [key, nestedValue] of Object.entries(value)) sanitized[key] = shouldRedactKey(key) ? REDACTED : redactValue(nestedValue, depth + 1);
  return sanitized;
}

function sanitizeAssistantChatBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const sanitizedBody = redactValue(body, 0) as Record<string, unknown>;
  const messageList = (body as Record<string, unknown>)['messages'];
  if ('messages' in sanitizedBody) {
    sanitizedBody['messages'] = {
      count: Array.isArray(messageList) ? messageList.length : undefined,
      redacted: true,
      roles: Array.isArray(messageList) ? messageList.map(getMessageRole).filter((role): role is string => typeof role === 'string') : [],
    };
  }
  return sanitizedBody;
}

function sanitizeHeaders(headers?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!headers) return headers;
  return redactSensitiveData(headers);
}

function sanitizeQuery(query: unknown): unknown {
  if (typeof query === 'string') return sanitizeQueryString(query);
  if (!query || typeof query !== 'object' || Array.isArray(query)) return query;
  const redactedQuery: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) redactedQuery[key] = SAFE_QUERY_KEYS.has(key) && isSafeScalar(value) ? value : REDACTED;
  return redactedQuery;
}

function sanitizeQueryString(queryString: string): Record<string, unknown> {
  const entries = new URLSearchParams(queryString.startsWith('?') ? queryString.slice(1) : queryString);
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of entries.entries()) sanitized[key] = SAFE_QUERY_KEYS.has(key) ? value : REDACTED;
  return sanitized;
}

function sanitizeUnknown(value: unknown, key?: string): unknown {
  if (key && isSensitiveKey(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [entryKey, sanitizeUnknown(entryValue, entryKey)]));
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return REDACTED_KEYS.some((sensitive) => normalized.includes(sensitive.toLowerCase()));
}

function stripPathIds(url: string): string {
  const [pathname = ''] = url.split('?');
  return pathname.replace(/\b(?:\d{3,}|[0-9a-f]{8,}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b/gi, '[REDACTED]');
}

function summarizeRedactedBody(body: unknown): unknown {
  if (body == null) return body;
  if (Array.isArray(body)) return { count: body.length, redacted: true, type: 'array' };
  if (typeof body !== 'object') return REDACTED;
  return { redacted: true, type: 'object' };
}

/** Provider bodies are usually a few hundred bytes; an HTML error page is not, and Sentry truncates. */
const PROVIDER_BODY_MAX_CHARS = 2000;

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/**
 * Pulls the provider's own explanation off a failed HTTP call, redacted and
 * length-capped, so it can ride along on a Sentry event.
 *
 * Without it an Axios rejection reaches Sentry as `AxiosError: Request failed
 * with status code 409` and nothing else, so every such event looks identical and
 * is undiagnosable. The reason the call failed is in
 * `response.data`, and interpolating the error into a string throws it away.
 *
 * The body goes through `redactSensitiveData` (blanks `iban` / `account*` /
 * `email` / `token` at any depth) because provider error payloads can echo
 * back the account details of the request that failed.
 *
 * Returns `undefined` when there is nothing useful to attach, so callers can
 * spread it conditionally rather than sending an empty `extra`.
 */
export function sanitizeProviderResponse(error: unknown): undefined | { body?: string; status?: number } {
  const response = (error as null | { response?: { data?: unknown; status?: unknown } })?.response;
  if (!response || typeof response !== 'object') return undefined;

  const status = typeof response.status === 'number' ? response.status : undefined;
  if (response.data === undefined || response.data === null) return status === undefined ? undefined : { status };

  const redacted = redactSensitiveData(response.data);
  const serialized = typeof redacted === 'string' ? redacted : safeStringify(redacted);
  if (serialized === undefined) return status === undefined ? undefined : { status };

  return {
    body: serialized.length > PROVIDER_BODY_MAX_CHARS ? `${serialized.slice(0, PROVIDER_BODY_MAX_CHARS)}…[truncated]` : serialized,
    status,
  };
}
