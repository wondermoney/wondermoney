import '@service/sentry';

import { Server } from 'http';
import { createRequire } from 'module';

import { RequestContext } from '@mikro-orm/postgresql';
import { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import * as Sentry from '@sentry/node';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors, { type CorsOptions } from 'cors';
import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import helmet from 'helmet';
import { StatusCodes } from 'http-status-codes';
import { isEmpty, isString } from 'lodash-es';
import swaggerUi from 'swagger-ui-express';
import { ZodError } from 'zod';

import { connectDatabase, DI } from '@app/database/di';
import { APP_ENV, IS_PRODUCTION_LIKE, NODE_ENV } from '@config/env';
import { enableBankingCallback } from '@controller/enable-banking-callback';
import { validateInviteController } from '@controller/household';
import { adminAuth, optionalAuth } from '@middleware/auth';
import { csrfOriginProtection } from '@middleware/csrf-origin';
import {
  adminApiRateLimit,
  assistantRateLimit,
  authExchangeRateLimit,
  globalBackstopRateLimit,
  importSessionRateLimit,
  inviteLookupRateLimit,
  publicMarketingRateLimit,
  publicReadRateLimit,
  supportRateLimit,
} from '@middleware/rate-limit';
import { requestEnqueue } from '@middleware/request-enqueue';
import { authedTenant, readOnlyTenantGated } from '@middleware/stacks';
import { getUserOptional } from '@middleware/user';
import accountRoutes from '@route/account';
import adminRoutes from '@route/admin';
import assistantRoutes from '@route/assistant';
import authRoutes from '@route/auth';
import backgroundOperationRoutes from '@route/background-operation';
import bankingRoutes from '@route/banking';
import budgetRoutes from '@route/budget';
import categoryRoutes from '@route/category';
import configsRoutes from '@route/configs';
import financialMarketsRoutes from '@route/financial-markets';
import goalRoutes from '@route/goal';
import healthRoutes from '@route/health';
import householdRoutes from '@route/household';
import instanceRoutes from '@route/instance';
import loanRoutes from '@route/loan';
import marketingRoutes from '@route/marketing';
import netWorthRoutes from '@route/net-worth';
import portfolioRoutes from '@route/portfolio';
import portfolioImportSessionRoutes from '@route/portfolio-import-session';
import recurringRoutes from '@route/recurring';
import reportsRoutes from '@route/reports';
import supportRoutes from '@route/support';
import userRoutes from '@route/user';
import { authHandler } from '@service/auth/better-auth';
import { ERROR, GITHUB_SHA, isCorsOriginAllowed } from '@utils/constants';
import { sanitizeRequestForLogging } from '@utils/error-sanitizer';
import { ERROR_CODE, NotFoundError, statusToErrorCode } from '@utils/errors';
import logger from '@utils/logger';
import httpLogger from '@utils/logger-http';

const require = createRequire(import.meta.url);
const swaggerDocument = require('./generated/swagger.json');

// Gated on the resolved app environment (`APP_ENV` → `DEPLOY_ENV` → `NODE_ENV`, failing closed on
// an unknown value) rather than a bare `NODE_ENV === 'production'` string match, so staging — which
// shares production origins in the CORS/CSRF allow-lists — inherits production's posture instead of
// publishing the full API surface map at `/docs`. This is the same gate the error handler uses.
const canExposeDiagnostics = !IS_PRODUCTION_LIKE || process.env['PUBLIC_DIAGNOSTICS_ENABLED'] === 'true';

if (isEmpty(NODE_ENV) || !isString(NODE_ENV)) {
  throw new Error('You need to set a NODE_ENV in the .env file');
}

export { connectDatabase, DI };



// allow: SIZE_OK — Express middleware and route composition root.
export default class Application {
  public em: EntityManager;
  public host: Express;
  public orm: MikroORM;
  public server: Server;

  public connect = async (): Promise<void> => {
    this.orm = await connectDatabase();
    this.em = DI.em = this.orm.em;
  };

  public init = (withServer = true): Promise<void> => {
    this.host = express();
    try {
      const corsOptions: CorsOptions = {
        credentials: true,
        origin(origin, callback) {
          if (!origin || isCorsOriginAllowed(origin)) {
            callback(null, true);
          } else {
            logger.error({ origin }, 'CORS error: origin not allowed');
            callback(new Error('Not allowed by CORS'));
          }
        },
      };
      this.host.use(cors(corsOptions));
      this.host.use(cookieParser());
      this.host.use(
        helmet({
          contentSecurityPolicy: {
            directives: {
              connectSrc: ["'self'", 'https:', 'http://localhost:3000', 'http://localhost:3001'],
              defaultSrc: ["'self'"],
            },
            useDefaults: true,
          },
          crossOriginResourcePolicy: { policy: 'same-site' },
          frameguard: { action: 'deny' },
          referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
        }),
      );
      this.host.use(httpLogger);
      this.host.set('trust proxy', 1);

      // RAD-547 — rate limiting is scoped per route family in `@middleware/rate-limit`.
      // This app-level limiter is only the crude per-IP backstop; the per-family budgets are
      // attached at each mount below, and the authenticated ones sit *after* `requireAuth` so
      // they can key on the verified Supabase subject instead of the source address.
      this.host.use(globalBackstopRateLimit());
      this.host.use(compression());

      // Rate-limit the sensitive better-auth subpaths ahead of the handler mount
      // below: sign-in (incl. /email), password reset (forget/reset-password) and
      // two-factor. Prefix matching covers the nested paths (e.g. /sign-in/email,
      // /two-factor/verify-totp). Kept as a separate use() so the better-auth
      // handler's own mount order (before express.json + csrfOriginProtection)
      // is untouched. The shared `authExchangeRateLimit` family in
      // `@middleware/rate-limit` already implements the per-family budget.
      this.host.use(
        ['/api/auth/sign-in', '/api/auth/forget-password', '/api/auth/reset-password', '/api/auth/two-factor'],
        authExchangeRateLimit(),
      );

      // better-auth runs embedded in `api`. Mount its handler BEFORE express.json
      // (it reads the raw request body itself — express.json would consume it and
      // hang sign-in) and BEFORE csrfOriginProtection (it runs its own origin check;
      // cross-subdomain trustedOrigins config lands in RAD-285). Express 5 requires
      // the named wildcard (`*splat`) rather than a bare `*`.
      this.host.all('/api/auth/*splat', authHandler);

      this.host.use((_req, _res, next) => {
        RequestContext.create(this.orm.em, next);
      });
      this.host.use(csrfOriginProtection);

      this.host.use(express.json({ limit: '2MB' }));
      this.host.use(express.urlencoded({ extended: true, limit: '2MB' }));
      // Request-scoped enqueue seam. Mounted after the better-auth handler and before every route
      // mount so gated handlers read `req.enqueue` instead of owning a pg-boss lifecycle. The adapter
      // is lazy: no connection is opened until a job is actually sent.
      this.host.use(requestEnqueue);
      if (canExposeDiagnostics) this.host.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
      else this.host.use('/docs', adminApiRateLimit(), adminAuth, swaggerUi.serve, swaggerUi.setup(swaggerDocument));

      // This is hit directly by the end user's browser being redirected back from their
      // bank via Enable Banking, which carries no WonderMoney auth token — `requireAuth`
      // would gate on the wrong thing.
      // Safety comes entirely from validating `state` server-side inside the controller
      // (`enableBankingCallback`), not from auth middleware.
      this.host.get('/v1/banking/enable-banking/callback', publicReadRateLimit(), enableBankingCallback);
      // Public, pre-signup: the /join page validates an invite token before the invitee has an account.
      // The invite token is a guessable secret, so this keeps a strict per-IP budget (RAD-547).
      this.host.get('/v1/household/invites/validate', inviteLookupRateLimit(), validateInviteController);

      this.host.use('/v1/account', ...authedTenant(), accountRoutes);
      this.host.use('/v1/admin', adminApiRateLimit(), adminAuth, adminRoutes);
      this.host.use('/v1/health', healthRoutes);
      // Credential surface: strict, per-IP, and never relaxed outside production (RAD-547).
      this.host.use('/v1/auth', authExchangeRateLimit(), optionalAuth, getUserOptional, authRoutes);
      this.host.use('/v1/banking', ...authedTenant(), bankingRoutes);
      this.host.use('/v1/budget', ...authedTenant(), budgetRoutes);
      // `resolveTenantForRequest`/`assertTenantResolved` are here for the same fail-loud invariant
      // every other authenticated data mount holds: without them this router ran on an EM with no
      // tenant context, so the global tenant filter stayed in system-bypass mode for the whole
      // request. The explicit ownership/membership checks in `background-operation.service.ts`
      // remain the real gate — this makes the default safe for anything added to the router later.
      this.host.use(
        '/v1/operations',
        ...readOnlyTenantGated(),
        backgroundOperationRoutes,
      );
      this.host.use('/v1/category', ...authedTenant(), categoryRoutes);
      this.host.use('/v1/loan', ...authedTenant(), loanRoutes);
      this.host.use('/v1/configs', ...authedTenant(), configsRoutes);
      this.host.use('/v1/goals', ...authedTenant(), goalRoutes);
      this.host.use('/v1/household', ...authedTenant(), householdRoutes);
      this.host.use('/v1/financial-markets', ...authedTenant(), financialMarketsRoutes);
      // Public: clients read it before sign-in (feature flags, signup mode, server identity).
      this.host.use('/v1/instance', instanceRoutes);
      this.host.use('/v1/marketing', publicMarketingRateLimit(), marketingRoutes);
      // Net worth is protected at mount level; route stays auth-agnostic.
      this.host.use('/v1/net-worth', ...authedTenant(), netWorthRoutes);
      this.host.use('/v1/portfolio', ...authedTenant(), portfolioRoutes);
      this.host.use('/v1/portfolio-import-sessions', ...authedTenant(importSessionRateLimit), portfolioImportSessionRoutes);
      this.host.use('/v1/assistant', ...authedTenant(assistantRateLimit), assistantRoutes);
      this.host.use('/v1/recurring', ...authedTenant(), recurringRoutes);
      this.host.use('/v1/reports', ...authedTenant(), reportsRoutes);
      this.host.use('/v1/support', supportRateLimit(), supportRoutes);
      this.host.use('/v1/user', ...authedTenant(), userRoutes);

      Sentry.setupExpressErrorHandler(this.host);

      this.host.use((req, res, next: NextFunction) => {
        if (req.get('User-Agent') === 'AlwaysOn' && req.path === '/') return res.sendStatus(StatusCodes.OK);
        next(new NotFoundError());
        return;
      });

      interface ErrorRequest extends ErrorRequestHandler {
        /** Stable machine-readable reason — see `ERROR_CODE` in `utils/errors.ts`. */
        code?: string;
        message?: string;
        retryAfter?: number;
        status?: number;
      }
      this.host.use((err: ErrorRequest, req: Request, res: Response, next: NextFunction) => {
        if (res.headersSent) {
          next(err);
          return;
        }
        // Expected client errors (4xx) — validation, auth, not-found — are normal outcomes,
        // not server bugs, and otherwise flood Sentry. Log them, but only report genuine
        // server failures (5xx) and uncaught errors (no status) to Sentry.
        const errorStatus = err instanceof ZodError ? 422 : (err.status ?? 500);
        // A feature this server does not have configured is a deployment choice, not a fault.
        const isFeatureDisabled = err.code === ERROR_CODE.FEATURE_DISABLED;
        if (errorStatus >= 500 && !isFeatureDisabled) {
          Sentry.captureException(err, {
            extra: {
              request: sanitizeRequestForLogging(req.path, {
                body: req.body,
                cookies: req.cookies,
                data: req.body,
                headers: req.headers,
                query: req.query,
              }),
            },
          });
        }
        logger.error(
          {
            error: err,
            request: {
              ...sanitizeRequestForLogging(req.path, {
                body: req.body,
                cookies: req.cookies,
                data: req.body,
                headers: req.headers,
                query: req.query,
              }),
              method: req.method,
              params: req.params,
              url: req.path,
              user: req.user?.appuserKey,
            },
            timestamp: new Date().toISOString(),
          },
          '🚨  Something went wrong',
        );
        if (err instanceof ZodError) {
          logger.warn({ error: err, validationErrors: err.errors }, 'Validation error');
          return res.status(422).json({ code: ERROR_CODE.VALIDATION_FAILED, message: err.message });
        }
        const status = err.status || 500;
        // Surface a rate-limit backoff hint to the client when the error carries one.
        if (typeof err.retryAfter === 'number' && Number.isFinite(err.retryAfter)) {
          res.setHeader('Retry-After', String(Math.ceil(err.retryAfter)));
        }
        // `code` is the stable, machine-readable reason. It is emitted in every environment
        // and for every status — including 5xx, where the message is deliberately withheld —
        // because a client branching on the reason must not have to parse English prose.
        // See `ERROR_CODE` in `utils/errors.ts` for why this exists.
        const code: string = typeof err.code === 'string' ? err.code : statusToErrorCode(status);

        // In production/staging: hide details for 5xx, show message for 4xx
        if (APP_ENV === 'production' || APP_ENV === 'staging') {
          const message = status >= 500 ? ERROR.SERVER : err.message || ERROR.SERVER;
          return res.status(status).json({ code, message });
        }
        return res.status(status).json({ code, message: err.message || ERROR.SERVER });
      });

      if (withServer) {
        const { PORT } = process.env;
        if (isEmpty(PORT) || !isString(PORT)) throw new Error('You need to set a PORT in the .env file');
        const PORT_N = Number.parseInt(PORT, 10);
        if (!isFinite(PORT_N)) {
          throw new Error('You need to set a valid PORT in the .env file');
        }
        this.server = this.host.listen(PORT_N, () => {
          logger.info(`🚀 Started version ${GITHUB_SHA} on port ${PORT} in ${APP_ENV} mode`);
        });
      }
    } catch (error) {
      // RAD-audit: this used to log and then `return Promise.resolve()`, so a failure to
      // register routes, bind the port or configure CORS produced one log line and a
      // *successfully started* process serving a partially-wired app. It also used
      // `JSON.stringify(error)`, which serialises an Error to `{}` — so the log line was
      // usually content-free. Fail loudly instead: the process manager restarting is a far
      // better outcome than silently serving a broken app.
      logger.error({ error }, '🚨 Could not start server');
      throw error;
    }
    return Promise.resolve();
  };
}
