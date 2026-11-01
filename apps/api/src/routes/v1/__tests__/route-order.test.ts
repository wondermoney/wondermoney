import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

/**
 * Route ordering, asserted behaviourally.
 *
 * Express matches routes in registration order, so a literal path registered *after* a
 * single-segment `/:param` route is unreachable — `GET /goals/available-to-assign` silently
 * becomes `getGoal({ goalKey: 'available-to-assign' })`, which 404s or 500s in production with
 * no compile-time warning. That is a real, user-visible failure mode, so it deserves a test.
 *
 * This replaces `goal-route-order`, `user-profile-route`, `portfolio-history-status-route`,
 * `admin-route` and the banking ordering case in `demo-guard-route-coverage`, all of which
 * asserted `router.stack` contents — an exact 15-element array of path strings, in one case.
 * Those turned every route addition into a test edit while proving nothing about dispatch.
 * Here we mount the real router, issue the real request, and assert which handler received it.
 *
 * Adding a route needs no change here. Adding a route that *shadows* an existing one fails here.
 */

/**
 * Stands in for a controller module. Every property access yields a handler that echoes its own
 * export name and the params Express bound — so the assertion reads "this path reached
 * `getAvailableToAssign` with no params", not "the stack array looks like X".
 *
 * A Proxy rather than a hand-listed object on purpose: the deleted tests each carried 10-35
 * lines of `vi.fn()` declarations that broke whenever an unrelated controller export was added.
 */
const { controllerStub } = vi.hoisted(() => {
  const RESERVED_MODULE_KEYS = new Set(['__esModule', 'constructor', 'default', 'then', 'toJSON']);

  return {
    controllerStub: () =>
      new Proxy<Record<string, unknown>>({}, {
        get: (target, property) => {
          if (typeof property !== 'string' || RESERVED_MODULE_KEYS.has(property)) return undefined;
          target[property] ??= (req: express.Request, res: express.Response) =>
            res.json({ handler: property, params: req.params });
          return target[property];
        },
        getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: undefined }),
        has: () => true,
        ownKeys: () => [],
      }),
  };
});

vi.mock('@controller/goal', controllerStub);
vi.mock('@controller/user', controllerStub);
vi.mock('@controller/onboarding', controllerStub);
vi.mock('@controller/email-notifications', controllerStub);
vi.mock('@controller/enable-banking-credential', controllerStub);
vi.mock('@controller/portfolio', controllerStub);
vi.mock('@controller/banking', controllerStub);
vi.mock('@controller/banking-connections', controllerStub);
vi.mock('@controller/admin/background-operation', controllerStub);
vi.mock('@controller/admin/demo-data', controllerStub);
vi.mock('@controller/admin/transaction-audit', controllerStub);
vi.mock('@controller/admin/transaction-enrichment', controllerStub);

// The portfolio router builds its market-data limiter at module scope. Swap it for a
// passthrough that tags the response, so the "is this endpoint rate limited?" question is
// answered by an observable header instead of by counting entries in `route.stack`.
vi.mock('@middleware/rate-limit', () => ({
  marketDataRateLimit: () => (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('x-market-data-limiter', 'applied');
    next();
  },
}));

const mount = async (modulePath: string) => {
  const { default: router } = (await import(modulePath)) as { default: express.Router };
  const app = express();
  app.use(express.json());
  app.use('/', router);

  return app;
};

type Method = 'delete' | 'get' | 'patch' | 'post' | 'put';

const dispatch = async (app: express.Express, method: Method, path: string) => {
  const response = await request(app)[method](path);

  expect(response.status, `${method.toUpperCase()} ${path} did not reach a handler`).toBe(200);

  return response.body as { handler: string; params: Record<string, string> };
};

describe('route ordering', () => {
  describe('goal router', () => {
    const cases: [Method, string, string][] = [
      ['get', '/available-to-assign', 'getAvailableToAssign'],
      ['get', '/debt-strategy', 'getGoalDebtStrategy'],
      ['get', '/', 'listGoals'],
      ['post', '/', 'createGoal'],
    ];

    it.each(cases)('%s %s is not swallowed by /:goalKey', async (method, path, handler) => {
      const app = await mount('@route/goal');

      const result = await dispatch(app, method, path);

      expect(result.handler).toBe(handler);
      expect(result.params).not.toHaveProperty('goalKey');
    });

    it('still routes a real goal id to the param handler', async () => {
      const app = await mount('@route/goal');

      await expect(dispatch(app, 'get', '/42')).resolves.toEqual({ handler: 'getGoal', params: { goalKey: '42' } });
      await expect(dispatch(app, 'get', '/42/activity')).resolves.toEqual({
        handler: 'getGoalActivity',
        params: { goalKey: '42' },
      });
      await expect(dispatch(app, 'post', '/42/restore')).resolves.toEqual({
        handler: 'restoreGoal',
        params: { goalKey: '42' },
      });
    });
  });

  describe('user router', () => {
    const cases: [Method, string, string][] = [
      ['get', '/me/profile', 'getCurrentUserProfile'],
      ['get', '/me/onboarding', 'getOnboardingBootstrap'],
      ['get', '/me/email-notification-preferences', 'getEmailNotificationPreferences'],
      ['delete', '/me', 'deleteCurrentUserAccount'],
      // Single-segment literal — the case `/:userId` most easily shadows.
      ['get', '/enable-banking-credential', 'getEnableBankingCredential'],
      ['post', '/enable-banking-credential', 'saveEnableBankingCredential'],
      ['delete', '/enable-banking-credential', 'deleteEnableBankingCredential'],
    ];

    it.each(cases)('%s %s is not swallowed by /:userId', async (method, path, handler) => {
      const app = await mount('@route/user');

      const result = await dispatch(app, method, path);

      expect(result.handler).toBe(handler);
      expect(result.params).not.toHaveProperty('userId');
    });

    it('still routes a real user id to the param handler', async () => {
      const app = await mount('@route/user');

      await expect(dispatch(app, 'get', '/42')).resolves.toEqual({
        handler: 'getUserAccountInformation',
        params: { userId: '42' },
      });
      await expect(dispatch(app, 'get', '/42/onboarding')).resolves.toEqual({
        handler: 'getOnboarding',
        params: { userId: '42' },
      });
    });
  });

  describe('portfolio router', () => {
    const cases: [Method, string, string][] = [
      ['get', '/dashboard', 'getAggregateDashboard'],
      ['get', '/performance', 'getPerformance'],
      ['get', '/allocation', 'getAllocation'],
      ['get', '/top-movers', 'getTopMovers'],
      ['get', '/transactions', 'getPortfoliosTransactions'],
      ['get', '/holdings', 'getPortfoliosHoldings'],
      ['get', '/brokers', 'getBrokers'],
      ['get', '/transaction-types', 'getTransactionTypes'],
      ['get', '/metrics', 'getPortfoliosMetrics'],
      ['get', '/calendar', 'getPortfolioCalendar'],
      ['get', '/dividend-income', 'getDividendIncome'],
    ];

    it.each(cases)('%s %s is not swallowed by /:portfolioId', async (method, path, handler) => {
      const app = await mount('@route/portfolio');

      const result = await dispatch(app, method, path);

      expect(result.handler).toBe(handler);
      expect(result.params).not.toHaveProperty('portfolioId');
    });

    it('routes /:portfolioId/history-status to its own handler, not GET /:portfolioId', async () => {
      // `/:portfolioId` is registered *before* `/:portfolioId/history-status`, so this only
      // works because Express requires a full path match — the ordering is load-bearing the
      // moment anyone adds a wildcard.
      const app = await mount('@route/portfolio');

      await expect(dispatch(app, 'get', '/9/history-status')).resolves.toEqual({
        handler: 'getPortfolioHistoryStatus',
        params: { portfolioId: '9' },
      });
      await expect(dispatch(app, 'get', '/9')).resolves.toEqual({
        handler: 'getPortfolio',
        params: { portfolioId: '9' },
      });
    });

    it('keeps holding-level market-data paths off the /:portfolioId branch', async () => {
      const app = await mount('@route/portfolio');

      await expect(dispatch(app, 'get', '/holding/AAPL/analyst')).resolves.toEqual({
        handler: 'getHoldingAnalystData',
        params: { symbol: 'AAPL' },
      });
      await expect(dispatch(app, 'get', '/holding/AAPL/valuation')).resolves.toEqual({
        handler: 'getHoldingValuation',
        params: { symbol: 'AAPL' },
      });
    });

    it('sends market-data reads through the rate limiter and plain reads around it', async () => {
      const app = await mount('@route/portfolio');

      await expect(request(app).get('/performance')).resolves.toMatchObject({
        headers: { 'x-market-data-limiter': 'applied' },
      });
      await expect(request(app).get('/calendar')).resolves.toMatchObject({
        headers: { 'x-market-data-limiter': 'applied' },
      });
      await expect(request(app).get('/9/history-status')).resolves.toMatchObject({
        headers: { 'x-market-data-limiter': 'applied' },
      });

      const unlimited = await request(app).get('/allocation');
      expect(unlimited.headers['x-market-data-limiter']).toBeUndefined();
    });
  });

  describe('admin router', () => {
    it('routes /operations/summary to the summary handler, not /operations/:operationId', async () => {
      const app = await mount('@route/admin');

      await expect(dispatch(app, 'get', '/operations/summary')).resolves.toEqual({
        handler: 'getAdminBackgroundOperationSummary',
        params: {},
      });
      await expect(dispatch(app, 'get', '/operations')).resolves.toEqual({
        handler: 'listAdminBackgroundOperations',
        params: {},
      });
      await expect(dispatch(app, 'get', '/operations/abc')).resolves.toEqual({
        handler: 'getAdminBackgroundOperation',
        params: { operationId: 'abc' },
      });
      await expect(dispatch(app, 'post', '/operations/abc/retry')).resolves.toEqual({
        handler: 'retryAdminBackgroundOperation',
        params: { operationId: 'abc' },
      });
    });

    it('keeps the audit and enrichment reads reachable', async () => {
      const app = await mount('@route/admin');

      await expect(dispatch(app, 'get', '/transactions/audit/dedup-skipped')).resolves.toMatchObject({
        handler: 'listDedupSkippedAudit',
      });
      await expect(dispatch(app, 'get', '/transactions/audit/remediations')).resolves.toMatchObject({
        handler: 'listRemediationAudit',
      });
      await expect(dispatch(app, 'get', '/enrichment/acceptance-rate')).resolves.toMatchObject({
        handler: 'getTransactionEnrichmentAcceptanceRate',
      });
    });
  });

  describe('banking router', () => {
    it('routes /bank and /connections ahead of the param routes', async () => {
      const app = await mount('@route/banking');

      await expect(dispatch(app, 'get', '/bank')).resolves.toEqual({ handler: 'getBankList', params: {} });
      await expect(dispatch(app, 'get', '/connections')).resolves.toEqual({
        handler: 'getBankConnections',
        params: {},
      });
      await expect(dispatch(app, 'get', '/sync/incident-1/status')).resolves.toEqual({
        handler: 'getBankSyncStatus',
        params: { incidentId: 'incident-1' },
      });
      await expect(dispatch(app, 'get', '/bank/bank-1/start')).resolves.toEqual({
        handler: 'startBankConnection',
        params: { bankId: 'bank-1' },
      });
    });
  });
});
