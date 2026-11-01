import { bossbench } from '@bossbench/express';
import apicache from 'apicache';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';

import { buildPgBossConfig } from '@app/jobs/pgboss.config';
import { getAdminBackgroundOperation, getAdminBackgroundOperationSummary, listAdminBackgroundOperations, PGBOSS_DASHBOARD_BASE_PATH, retryAdminBackgroundOperation } from '@controller/admin/background-operation';
import { triggerDemoDataRefresh } from '@controller/admin/demo-data';
import { listDedupSkippedAudit, listRemediationAudit } from '@controller/admin/transaction-audit';
import { getTransactionEnrichmentAcceptanceRate } from '@controller/admin/transaction-enrichment';

const router = express.Router();

// pg-boss job dashboard (replacement for @pg-boss/dashboard). Already behind this
// router's adminAuth + adminAuthLimiter mount in app.ts, so bossbench's own basic-auth
// login is optional defense-in-depth, not the primary gate. No live PgBoss instance is
// wired in (`boss` option omitted), so this stays read-only monitoring — job
// retry/cancel/delete still goes through POST /v1/admin/operations/:operationId/retry.
//
// Built lazily on first request rather than at module load: buildPgBossConfig() reads
// DB_* env vars, and this module is imported (evaluated) before app.ts's own
// dotenv.config() call runs, so DB_* wouldn't be populated yet in local dev.
let bossbenchRouter: Router | undefined;
router.use('/jobs', (req: Request, res: Response, next: NextFunction) => {
  if (!bossbenchRouter) {
    const pgBossConnection = buildPgBossConfig();
    bossbenchRouter = bossbench({
      // The mount is already behind `adminApiRateLimit` + `adminAuth` (see app.ts), which
      // the comment above calls the primary gate. A second credential pair was supported
      // via BOSSBENCH_USER/BOSSBENCH_PASS and never set in any environment, so it only ever
      // took this branch. Removed rather than left as a knob nobody turned.
      allowUnauthenticated: true,
      basePath: PGBOSS_DASHBOARD_BASE_PATH,
      db: pgBossConnection.connectionString,
      schema: pgBossConnection.schema,
      title: 'WonderMoney Jobs',
    });
  }
  bossbenchRouter(req, res, next);
});

router.get('/performance', (_req: Request, res: Response) => {
  res.json(apicache.getPerformance());
});

router.get('/index', (_req: Request, res: Response) => {
  res.json(apicache.getIndex());
});

router.get('/operations', listAdminBackgroundOperations);
router.get('/operations/summary', getAdminBackgroundOperationSummary);
router.get('/operations/:operationId', getAdminBackgroundOperation);
router.post('/operations/:operationId/retry', retryAdminBackgroundOperation);

router.post('/demo-data/refresh', triggerDemoDataRefresh);

// Transaction audit-log monitoring reads (cross-tenant, hence admin-gated rather than on
// the user-facing /v1/transactions/* surface). newest-first, offset-paginated.
router.get('/transactions/audit/dedup-skipped', listDedupSkippedAudit);
router.get('/transactions/audit/remediations', listRemediationAudit);

// Transaction-enrichment acceptance-rate observability (cross-tenant, admin-gated).
router.get('/enrichment/acceptance-rate', getTransactionEnrichmentAcceptanceRate);

export default router;
