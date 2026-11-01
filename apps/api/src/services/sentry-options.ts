import path from 'path';
import { fileURLToPath } from 'url';

import * as Sentry from '@sentry/node';

import { APP_ENV, SHOULD_ENABLE_SENTRY } from '@config/env';
import { normalizeRequestPath, redactSensitiveData, sanitizeErrorRequestBody } from '@utils/error-sanitizer';

import { GITHUB_SHA } from '../utils/constants';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CI (prd.yml / staging.yml) rewrites the GITHUB_SHA placeholder to a real commit
// SHA at image build time; a local `node`/`tsx` run leaves it untouched. Requiring a
// rewritten SHA guarantees only genuinely-deployed images report to Sentry, so a
// developer running with APP_ENV/NODE_ENV=production locally can never pollute the
// production environment (see API-W4).
// Cast widens GITHUB_SHA from its string-literal type so the comparison isn't flagged as
// "always false" — at build time CI has replaced the placeholder with a real SHA.
const IS_DEPLOYED_BUILD = (GITHUB_SHA as string) !== '##REPLACE_GITHUB_COMMIT_SHA_HERE##';

const { SENTRY_DSN } = process.env;

const SCANNER_NOT_FOUND_PATHS = [
  /^\/\.env(?:$|[./?#])/,
  /^\/wp-content\//,
  /^\/robots[^/]*\.txt(?:$|[./?#])/,
  /^\/src\/\.env(?:$|[./?#])/,
  /^\/web\/\.env(?:$|[./?#])/,
  // Root-level archive/backup/dump probes (e.g. /htdocs.tar.gz, /backup.zip, /db.sql) — always a scanner.
  /^\/[^/]+\.(?:tar\.gz|tgz|zip|rar|7z|sql|bak|old|backup|save)(?:$|[?#])/,
];

function isAdminUnauthorizedNoise(errorType: string | undefined, requestUrl: string | undefined) {
  return errorType === 'UnauthorizedError' && requestUrl?.includes('/v1/admin/');
}

// Scanners hammer the API-key-protected Swagger docs (`/docs`) with no key, producing a steady
// stream of UnauthorizedError (and ValidationError from the rate limiter). None of it is actionable.
function isDocsProbeNoise(errorType: string | undefined, requestUrl: string | undefined) {
  if (!requestUrl) return false;
  const normalizedPath = normalizeRequestPath(requestUrl);
  const isDocsPath = normalizedPath === '/docs' || normalizedPath.startsWith('/docs/') || normalizedPath.startsWith('/docs.');
  return isDocsPath && (errorType === 'UnauthorizedError' || errorType === 'ValidationError');
}

// express-rate-limit throws a ValidationError when it can't parse a client IP (spoofed/malformed
// forwarding headers from scanners). Path-agnostic — it is never a real bug.
type DataCollection = NonNullable<Sentry.NodeOptions['dataCollection']>;

function isRateLimitInvalidIpNoise(errorType: string | undefined, event: Sentry.Event) {
  if (errorType !== 'ValidationError') return false;
  const exception = event.exception?.values?.[0];
  const hasInvalidIpMessage = exception?.value?.toLowerCase().includes('invalid ip') ?? false;
  const hasRateLimitMechanism = exception?.mechanism?.type === 'express-rate-limit';
  return hasInvalidIpMessage || hasRateLimitMechanism;
}

function isScannerNoise(errorType: string | undefined, requestUrl: string | undefined) {
  if (errorType !== 'NotFoundError' || !requestUrl) return false;
  const normalizedPath = normalizeRequestPath(requestUrl);
  return SCANNER_NOT_FOUND_PATHS.some((pattern) => pattern.test(normalizedPath));
}

/**
 * What a Sentry event from the API or worker may carry (issue #38). Sentry 11 collects everything
 * by default when `dataCollection` is unset — request/response bodies, cookies, every header, query
 * strings, user info, database query parameters/results, queue arguments and gen-AI inputs/outputs —
 * so every category is stated here. Both the API (`app.ts`) and the worker (`worker.ts`) initialise
 * Sentry through `buildSentryOptions()`.
 *
 * Allow-lists are matched by Sentry as case-insensitive substrings, so every term must be specific
 * enough not to admit a sensitive key; Sentry also filters keys containing `auth`, `token`,
 * `session`, `key`, `cookie` and similar even when allow-listed. The query allow-list mirrors
 * `SAFE_QUERY_KEYS` in `utils/error-sanitizer.ts`.
 *
 * https://docs.sentry.io/platforms/javascript/data-management/data-collected/
 * https://docs.sentry.io/platforms/javascript/migration/v10-to-v11/
 */
export const SENTRY_DATA_COLLECTION: DataCollection = {
  // No email, username or IP. The user id is attached explicitly by `middleware/user.ts`.
  cookies: false,
  databaseQueryData: false,
  genAI: { inputs: false, outputs: false },
  graphQL: { document: false, variables: false },
  httpBodies: [],
  httpHeaders: {
    request: { allow: ['user-agent', 'content-type', 'content-length'] },
    response: { allow: ['content-type', 'content-length'] },
  },
  queues: false,
  urlQueryParams: { allow: ['page', 'limit', 'offset', 'sort', 'order', 'direction'] },
  userInfo: false,
  // Local variable values can hold balances and request input.
  stackFrameVariables: false,
};

export function buildSentryOptions(): Sentry.NodeOptions {
  return {
    dsn: SENTRY_DSN,
    environment: APP_ENV,
    maxValueLength: 8196,
    // What an event may carry (issue #38). Applied by the SDK before `beforeSend`, which still
    // runs its own scrub over whatever is left.
    beforeSend(event) {
      const request = event.request;
      const requestUrl = request?.url;
      const errorType = event.exception?.values?.[0]?.type;
      if (
        isScannerNoise(errorType, requestUrl)
        || isAdminUnauthorizedNoise(errorType, requestUrl)
        || isDocsProbeNoise(errorType, requestUrl)
        || isRateLimitInvalidIpNoise(errorType, event)
      ) {
        return null;
      }
      if (request) {
        const sanitizedPath = normalizeRequestPath(requestUrl ?? '');
        event.request = {
          ...request,
          cookies: undefined,
          data: sanitizeErrorRequestBody(sanitizedPath, request.data),
          headers: redactSensitiveData(request.headers),
          query_string: sanitizeErrorRequestBody(sanitizedPath, request.query_string) as typeof request.query_string,
          url: sanitizedPath,
        };
      }
      return event;
    },
    dataCollection: SENTRY_DATA_COLLECTION,
    enabled: SHOULD_ENABLE_SENTRY && IS_DEPLOYED_BUILD,
    ignoreErrors: ['Non-Error exception captured'],
    integrations: [
      // `errorHandler` (middleware/error-handler.ts) decides what is reported. Sentry's own capture
      // would also send ZodErrors (no status, so "500") and 501 feature_disabled.
      Sentry.expressIntegration({ shouldHandleError: false }),
      // Deliberately excludes 'log': console.log() is not an error. Capturing it turned MikroORM
      // query/discovery debug output and lambda console.log() calls (e.g. "Exchanges inserted",
      // "Found symbols…") into ~50 phantom Sentry issues. Real problems use warn/error and above.
      Sentry.captureConsoleIntegration({ levels: ['warn', 'warning', 'error', 'emerg', 'alert', 'crit'] }),
      Sentry.rewriteFramesIntegration({
        root: path.resolve(__dirname, '..'),
      }),
      Sentry.postgresIntegration(),
      Sentry.pinoIntegration(),
      Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] }),
    ],
    release: GITHUB_SHA,
    tracesSampler: (ctx) => {
      return ctx.normalizedRequest?.method === 'OPTIONS' ? false : (ctx.parentSampled ?? true);
    },
    tracesSampleRate: 0.3,
  };
}
