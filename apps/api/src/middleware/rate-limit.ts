import * as Sentry from '@sentry/node';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit, type RateLimitInfo } from 'express-rate-limit';
import { StatusCodes } from 'http-status-codes';

import { IS_PROD } from '@config/env';
import { ERROR_CODE } from '@utils/errors';
import logger from '@utils/logger';

// RAD-547 — until this module existed, one 150-request / 15-minute in-memory bucket was
// shared by every endpoint on the API. Because the bucket was global, ordinary product
// reads (a budget page fans out into a double-digit number of requests on first paint)
// competed for the same allowance as credential endpoints, and the only way to clear the
// counter was to restart the process.
//
// The model here is: one *named family* per class of traffic, each with its own store, its
// own ceiling and its own key scope. Two rules govern the numbers:
//
//   1. Ordinary authenticated reads get a ceiling high enough that a human cannot reach it
//      by browsing, and they are keyed per authenticated identity so one office NAT cannot
//      throttle a whole company.
//   2. Anything brute-forceable — credential exchange, admin API keys, invite tokens,
//      unauthenticated public surfaces — stays strict, stays keyed on IP, and is *never*
//      relaxed by the non-production escape hatch below.

const MINUTE_MS = 60 * 1000;
const QUARTER_HOUR_MS = 15 * MINUTE_MS;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Outside production, relaxable families are multiplied so that a manual QA sweep over
 * every authenticated route cannot trip them.
 *
 * RAD-567 — this is a **code constant, not configuration**. It was briefly readable from
 * `RATE_LIMIT_RELAXED_MULTIPLIER` so it could be tuned per environment without a deploy,
 * but the variable was never set anywhere: every environment ran on this default, and the
 * only thing the indirection bought was a second place for the value to disagree with
 * itself. Production ignores it outright, so there was never a knob worth turning.
 *
 * The decision is made **once, at module load, from the server-side environment only**
 * (`APP_ENV`/`DEPLOY_ENV`/`NODE_ENV` via `@config/env`). No request header, query parameter
 * or body field participates, so a caller cannot talk the API into relaxing its own
 * limits. Strict families opt out entirely — see `relaxable: false` below — so staging
 * keeps production-grade brute-force protection.
 */
const RELAXED_MULTIPLIER_OUTSIDE_PRODUCTION = 10;

export const RELAXED_MULTIPLIER = IS_PROD ? 1 : RELAXED_MULTIPLIER_OUTSIDE_PRODUCTION;

interface CreateRateLimiterOptions {
  family: RateLimitFamilyName;
  /** Server-side predicate for traffic that must never be counted (the container healthcheck). */
  skip?: (req: Request) => boolean;
}

interface RateLimitFamily {
  /** Requests allowed per window in production. */
  limit: number;
  /** When true, the ceiling is multiplied outside production. Strict families must stay false. */
  relaxable: boolean;
  /**
   * `identity` keys on the authenticated better-auth user id (or the app user key) and only
   * falls back to IP.
   * `ip` always keys on the source address — correct for unauthenticated/credential surfaces.
   */
  scope: 'identity' | 'ip';
  windowMs: number;
}

export const RATE_LIMIT_FAMILIES = {
  /**
   * `/v1/admin` and the gated Swagger UI. Unauthenticated scanners hammer these constantly
   * and every rejection used to become a Sentry event (see the original comment in app.ts).
   * Five attempts per quarter hour per IP against an `x-api-key` compare — never relaxed.
   */
  adminApi: { limit: 5, relaxable: false, scope: 'ip', windowMs: QUARTER_HOUR_MS },

  /**
   * `/v1/assistant` mutations — the LLM calls that cost money per request. Well above any
   * human chat cadence, well below a scripted drain of the AI budget. The router's cheap
   * GETs (consent, audit log) ride the ordinary `read` family instead.
   */
  assistant: { limit: 60, relaxable: true, scope: 'identity', windowMs: QUARTER_HOUR_MS },

  /**
   * `/v1/auth/callback` — the Supabase token exchange that provisions the app user.
   * Forging a token needs the HS256 secret, but this is the credential-shaped edge of the
   * API and the one place a token-replay probe would aim, so it stays IP-keyed, strict,
   * and unaffected by the non-production multiplier.
   */
  authExchange: { limit: 30, relaxable: false, scope: 'ip', windowMs: QUARTER_HOUR_MS },

  /**
   * Crude per-IP backstop in front of everything, including the auth middleware itself, so
   * an unauthenticated flood cannot force the API to verify thousands of JWTs. It is not the
   * per-endpoint budget — the families below are — it is the ceiling on any single address.
   */
  globalBackstop: { limit: 3000, relaxable: true, scope: 'ip', windowMs: QUARTER_HOUR_MS },

  /**
   * Portfolio statement/CSV import *mutations*: parsing and column/asset mapping are CPU- and
   * IO-heavy. The preview GET the wizard polls while a parse runs rides the `read` family, so
   * polling can never exhaust the parse budget.
   */
  importSession: { limit: 120, relaxable: true, scope: 'identity', windowMs: QUARTER_HOUR_MS },

  /**
   * `/v1/household/invites/validate` — public, pre-signup, and takes an invite token in the
   * query string. That makes it the one genuinely guessable-secret endpoint on the public
   * surface, so it gets a tighter ceiling than the old blanket rule ever gave it, IP-keyed
   * and never relaxed.
   */
  inviteLookup: { limit: 20, relaxable: false, scope: 'ip', windowMs: QUARTER_HOUR_MS },

  /**
   * Reads that fan out to the paid market-data provider (EODHD) even when cached. Six to
   * eight of these land on a single portfolio page load, so the previous per-route ceilings
   * of 60 and 300 were the tightest limits in the app; 600 keeps the vendor spend bounded
   * without punishing a browsing session.
   */
  marketData: { limit: 600, relaxable: true, scope: 'identity', windowMs: QUARTER_HOUR_MS },

  /** `/v1/marketing` — unauthenticated opt-out/lead endpoints. Unchanged from the previous rule. */
  publicMarketing: { limit: 50, relaxable: false, scope: 'ip', windowMs: QUARTER_HOUR_MS },

  /**
   * Unauthenticated reads with no secret in them: the Enable Banking bank-connection redirect.
   * Keyed on IP because there is no identity yet, so the ceiling has to leave room for
   * carrier-grade NAT.
   */
  publicRead: { limit: 300, relaxable: true, scope: 'ip', windowMs: QUARTER_HOUR_MS },

  /**
   * Ordinary authenticated GET/HEAD traffic — the family the ticket is about. A budget page
   * costs on the order of 15 requests, so 1200 is roughly eighty page loads in fifteen
   * minutes: unreachable by hand, still a bound on a runaway client.
   */
  read: { limit: 1200, relaxable: true, scope: 'identity', windowMs: QUARTER_HOUR_MS },

  /** `/v1/support` — sends email. Unchanged from the previous rule. */
  support: { limit: 5, relaxable: false, scope: 'ip', windowMs: HOUR_MS },

  /** Authenticated mutations on ordinary product data. */
  write: { limit: 300, relaxable: true, scope: 'identity', windowMs: QUARTER_HOUR_MS },
} as const satisfies Record<string, RateLimitFamily>;

export type RateLimitFamilyName = keyof typeof RATE_LIMIT_FAMILIES;

export function resolveFamilyLimit(name: RateLimitFamilyName): number {
  const family = RATE_LIMIT_FAMILIES[name];
  return family.relaxable ? family.limit * RELAXED_MULTIPLIER : family.limit;
}

/**
 * Build the counter key for a family.
 *
 * `req.authUser` is only ever populated by the auth middleware after a verified better-auth
 * session, and `req.user` only after a database lookup keyed on that same subject. Neither
 * is readable from anything the client controls, so a caller cannot nominate its own bucket.
 * Requests that carry no verified identity fall back to the source IP.
 */
export function buildRateLimitKey(req: Request, scope: RateLimitFamily['scope']): string {
  if (scope === 'identity') {
    const subject = req.authUser?.user.id ?? req.user?.appuserKey;
    if (subject !== undefined && String(subject).length > 0) {
      return `u:${String(subject)}`;
    }
  }
  return `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
}

/** Build the middleware for one named family. */
export function createRateLimiter({ family, skip }: CreateRateLimiterOptions): RequestHandler {
  const { scope, windowMs } = RATE_LIMIT_FAMILIES[family];

  return rateLimit({
    handler: buildLimitHandler(family),
    keyGenerator: (req) => buildRateLimitKey(req, scope),
    legacyHeaders: false,
    limit: resolveFamilyLimit(family),
    skip,
    standardHeaders: 'draft-7',
    windowMs,
  });
}

/**
 * RAD-567 — making a mis-sized family visible.
 *
 * The ceilings were sized from an estimate of how many requests a page costs, not from
 * measured traffic. A single 429 is not an incident and must not page, so the handler
 * deliberately bypasses the shared error handler. The cost of that: the only trace of a
 * family that is far too tight is a `warn` line nobody reads.
 *
 * So: count every 429 per family, and raise **one** Sentry event per family per hour once
 * a family passes a threshold no ordinary user should reach. That is loud enough to notice
 * a bad ceiling and quiet enough that a scripted client cannot turn it into a flood.
 *
 * The counter is per-process and resets on deploy, which is fine — this is a signal that
 * something is wrong, not a metric to reconcile.
 */
export const RATE_LIMIT_REPORT_THRESHOLD = 50;
const RATE_LIMIT_REPORT_WINDOW_MS = HOUR_MS;

interface FamilyBreachWindow {
  count: number;
  reported: boolean;
  windowStart: number;
}

const breachWindows = new Map<RateLimitFamilyName, FamilyBreachWindow>();

/** Exported for tests: drops the accumulated counters. */
export function resetRateLimitBreachCounters(): void {
  breachWindows.clear();
}

function recordBreach(family: RateLimitFamilyName, limit: number | undefined): void {
  const now = Date.now();
  const current = breachWindows.get(family);

  if (!current || now - current.windowStart >= RATE_LIMIT_REPORT_WINDOW_MS) {
    breachWindows.set(family, { count: 1, reported: false, windowStart: now });
    return;
  }

  current.count += 1;
  if (current.reported || current.count < RATE_LIMIT_REPORT_THRESHOLD) return;

  current.reported = true;
  Sentry.captureMessage(`Rate limit family "${family}" is breaching repeatedly`, {
    extra: {
      breaches: current.count,
      limit,
      thresholdWindowMs: RATE_LIMIT_REPORT_WINDOW_MS,
      windowStart: new Date(current.windowStart).toISOString(),
    },
    level: 'warning',
    tags: { family, rate_limit_family: family },
  });
}

/**
 * 429 responder. Emits a standards-compliant `Retry-After` (delta-seconds) plus a
 * machine-readable JSON body so the web layer can show "too many requests, retrying"
 * instead of a generic error screen. Kept out of the shared error handler on purpose: a
 * 429 is an expected outcome, not an application error, and must not be reported to Sentry
 * as an exception — see `recordBreach` for the aggregate signal that replaces it.
 */
function buildLimitHandler(family: RateLimitFamilyName) {
  return (req: Request, res: Response, _next: NextFunction): void => {
    // express-rate-limit augments `express.Request` with `rateLimit`, but this project ships
    // its own `Express.Request` augmentation, which shadows it. Narrow locally instead.
    const info = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit;
    const remainingMs = info?.resetTime ? info.resetTime.getTime() - Date.now() : RATE_LIMIT_FAMILIES[family].windowMs;
    const retryAfter = Math.max(1, Math.ceil(remainingMs / 1000));

    res.setHeader('Retry-After', String(retryAfter));
    logger.warn(
      { family, limit: info?.limit, method: req.method, mount: req.baseUrl, path: req.path, retryAfter },
      'Rate limit exceeded',
    );

    // A breadcrumb, not an event: if this request later fails for a real reason, the 429s
    // that preceded it are visible in that error's trail without generating traffic of
    // their own.
    Sentry.addBreadcrumb({
      category: 'rate-limit',
      data: { family, limit: info?.limit, method: req.method, mount: req.baseUrl, retryAfter },
      level: 'warning',
      message: `Rate limit exceeded for "${family}"`,
    });
    recordBreach(family, info?.limit);

    res.status(StatusCodes.TOO_MANY_REQUESTS).json({
      code: ERROR_CODE.TOO_MANY_REQUESTS,
      family,
      message: 'Too many requests. Please retry shortly.',
      retryAfter,
    });
  };
}

/**
 * Split a mount into separate read and write budgets. GET/HEAD/OPTIONS are cheap and
 * bursty; mutations are neither, and lumping them together is what made the old single
 * bucket behave badly. Each half keeps its own store, so exhausting one never blocks the
 * other.
 */
export function createMethodScopedRateLimiter(read: RateLimitFamilyName, write: RateLimitFamilyName): RequestHandler {
  const readLimiter = createRateLimiter({ family: read });
  const writeLimiter = createRateLimiter({ family: write });
  const readMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

  return (req: Request, res: Response, next: NextFunction) => {
    const limiter = readMethods.has(req.method.toUpperCase()) ? readLimiter : writeLimiter;
    limiter(req, res, next);
  };
}

/**
 * Coolify's Docker healthcheck hits `GET /v1/health` every ~5s. A 429 there marks the
 * container unhealthy after a redeploy (RAD-305), so it never counts against any family.
 */
export const isHealthCheckPath = (req: Request): boolean =>
  req.path === '/v1/health' || req.path.startsWith('/v1/health/');

// ---------------------------------------------------------------------------
// Ready-made limiters.
//
// Every helper is a *factory*, called once per mount. That gives each mount its own store, so
// a runaway poller on one page exhausts only its own budget and never starves another route
// family — and it keeps this module free of import-time side effects.
// ---------------------------------------------------------------------------

/** Per-IP backstop in front of the whole app, including the auth middleware. */
export const globalBackstopRateLimit = (): RequestHandler =>
  createRateLimiter({ family: 'globalBackstop', skip: isHealthCheckPath });

/** `/v1/admin` and the credential-gated Swagger UI. */
export const adminApiRateLimit = (): RequestHandler => createRateLimiter({ family: 'adminApi' });

/** `/v1/auth` — Supabase token exchange. */
export const authExchangeRateLimit = (): RequestHandler => createRateLimiter({ family: 'authExchange' });

/** `/v1/household/invites/validate` — public invite-token lookup. */
export const inviteLookupRateLimit = (): RequestHandler => createRateLimiter({ family: 'inviteLookup' });

/** `/v1/marketing` — public opt-out and lead endpoints. */
export const publicMarketingRateLimit = (): RequestHandler => createRateLimiter({ family: 'publicMarketing' });

/** `/v1/support` — sends email. */
export const supportRateLimit = (): RequestHandler => createRateLimiter({ family: 'support' });

/** Unauthenticated reads with no secret in them. */
export const publicReadRateLimit = (): RequestHandler => createRateLimiter({ family: 'publicRead' });

/** `/v1/assistant` — cheap GETs on the ordinary read budget, LLM calls on their own. */
export const assistantRateLimit = (): RequestHandler => createMethodScopedRateLimiter('read', 'assistant');

/** `/v1/portfolio-import-sessions` — preview polling on the read budget, parsing on its own. */
export const importSessionRateLimit = (): RequestHandler => createMethodScopedRateLimiter('read', 'importSession');

/** Reads that reach the paid market-data provider; called per route group. */
export const marketDataRateLimit = (): RequestHandler => createRateLimiter({ family: 'marketData' });

/**
 * The default for an authenticated product mount. Must be mounted *after* `requireAuth` so
 * that `req.supabaseUser` carries a verified subject to key on. Called per mount.
 */
export const productDataRateLimit = (): RequestHandler => createMethodScopedRateLimiter('read', 'write');
