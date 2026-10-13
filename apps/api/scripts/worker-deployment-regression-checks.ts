import { readFileSync } from 'node:fs';

function assertContains(filePath: string, needle: string) {
  const contents = readFileSync(filePath, 'utf8');

  if (!contents.includes(needle)) {
    throw new Error(`${filePath} is missing required content: ${needle}`);
  }
}

function assertNotContains(filePath: string, needle: string) {
  const contents = readFileSync(filePath, 'utf8');

  if (contents.includes(needle)) {
    throw new Error(`${filePath} contains forbidden content: ${needle}`);
  }
}

function assertContainedBetween(filePath: string, start: string, end: string, needle: string) {
  const contents = readFileSync(filePath, 'utf8');
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end, startIndex + start.length);

  if (startIndex < 0 || endIndex < 0 || !contents.slice(startIndex, endIndex).includes(needle)) {
    throw new Error(`${filePath} does not guard required content between ${start} and ${end}: ${needle}`);
  }
}

assertContains('Dockerfile', 'FROM runtime-base AS worker');
assertContains('Dockerfile', 'CMD ["node", "dist/worker.js"]');
assertContains('src/worker.ts', "import '@service/sentry';");
// The published images (the hosted deploy workflows build the same Dockerfile targets).
assertContains('../../.github/workflows/publish-images.yml', 'target: worker');
assertContains('.env.sample', 'ENABLE_BUDGET_EMAIL_SCHEDULE=true');
assertContains('.env.sample', 'ENABLE_BUDGET_EMAIL_CONSUMER=true');
assertContains('.env.sample', 'ENABLE_WEEKLY_EMAIL_SCHEDULE=true');
assertContains('.env.sample', 'ENABLE_WEEKLY_EMAIL_CONSUMER=true');
assertContains('src/jobs/financial-emails.queue.ts', "email.budget.coordinator");
assertContains('src/jobs/financial-emails.queue.ts', "email.weekly.user");
assertContains('src/jobs/financial-emails.queue.ts', "0 9 * * *");
assertContains('src/jobs/financial-emails.queue.ts', "0 9 * * 1");
assertContains('src/jobs/financial-emails.queue.ts', "Europe/Lisbon");
assertContains('src/jobs/worker.ts', 'unscheduleBudgetEmails');
assertContains('src/jobs/worker.ts', 'unscheduleWeeklyEmails');
assertContains('.env.sample', 'BANK_RECOVERY_MODE=off');
assertContains('.env.sample', '# Bank recovery is fail-closed by default. Enable only through an approved release manifest.');
assertContains('src/jobs/bank-recovery.worker.ts', "import { BACKEND_URL, FRONTEND_URL } from '@utils/constants';");
assertNotContains('src/jobs/bank-recovery.worker.ts', "['FRONTEND_URL']");
assertNotContains('.env.sample', 'BANK_RECOVERY_ALLOWLIST');
assertContains('src/jobs/worker.ts', 'await ensureBankRecoveryQueue(boss);');
assertContains('src/jobs/worker.ts', 'await ensureBankRecoveryDispatchQueue(boss);');
assertContains('src/jobs/worker.ts', 'BANK_RECOVERY_QUEUE,');
assertContains('src/jobs/worker.ts', 'BANK_RECOVERY_DISPATCH_QUEUE,');
assertContains('src/jobs/worker.ts', 'handleBankRecoveryJob(job, { logger: log })');
assertContains('src/jobs/worker.ts', 'handleBankRecoveryDispatchJob(boss)');
assertNotContains('src/jobs/worker.ts', 'ENABLE_PGBOSS_SCHEDULED_EMAILS');
assertContains('src/jobs/worker.ts', 'if (schedulerEnabled()) {');
// 010b8d1b ("Disable Stripe checkout endpoints, pause marketing lifecycle emails")
// paused the bank-recovery dispatch: the schedule call became an explicit
// unschedule. What still matters is that the call stays *inside* the
// scheduler-owner block, so only the PGBOSS_SCHEDULE owner touches the schedule.
assertContainedBetween(
  'src/jobs/worker.ts',
  'if (schedulerEnabled()) {',
  '\n    }\n\n    await boss.work',
  'await unscheduleBankRecoveryDispatchJob(boss);',
);
// Retired schedules and queues are removed by the scheduler owner only — see
// src/jobs/retired-queues.ts.
assertContainedBetween(
  'src/jobs/worker.ts',
  'if (schedulerEnabled()) {',
  '\n    }\n\n    await boss.work',
  'await removeRetiredQueues(boss);',
);
assertNotContains('src/server.ts', 'scheduleBankRecoveryDispatchJob');
assertNotContains('src/app.ts', 'scheduleBankRecoveryDispatchJob');
assertNotContains('src/controller/banking.ts', 'nrid');

// Worker heartbeat (dead-man's switch) wiring: the ping schedule must live inside
// the PGBOSS_SCHEDULE owner block AND be gated on the heartbeat URL being present,
// so no non-prod environment ever pings the production monitor.
assertContains('.env.sample', 'HETRIX_WORKER_HEARTBEAT_URL=');
assertContains('src/jobs/worker-heartbeat.queue.ts', "export const WORKER_HEARTBEAT_QUEUE = 'worker.heartbeat';");
assertContains('src/jobs/worker-heartbeat.queue.ts', "'*/2 * * * *'");
assertContains('src/jobs/worker.ts', 'await ensureWorkerHeartbeatQueue(boss);');
assertContains('src/jobs/worker.ts', 'handleWorkerHeartbeatJob({ logger: log })');
assertContainedBetween(
  'src/jobs/worker.ts',
  'if (schedulerEnabled()) {',
  '\n    }\n\n    await boss.work',
  'if (workerHeartbeatEnabled()) await scheduleWorkerHeartbeatJob(boss);',
);

// --- Observability guardrails -------------------------------------------------
//
// These three are the difference between "a queue stopped draining" being a page and
// being a support ticket six weeks later. Each one was, at some point, wired to exactly
// one queue or to none at all, and nothing caught the drift.

// Every boss.work() handler must go through the Sentry-instrumenting wrapper.
// `boss.on('error')` does NOT fire for handler rejections, so an unwrapped handler is a
// queue that can fail every job in silence.
assertContains('src/jobs/worker.ts', "import { instrumentedBatch } from '@app/jobs/job-instrumentation';");
assertNotContains('src/jobs/worker.ts', 'async (jobs: Job<unknown>[]) => {');
assertNotContains('src/jobs/worker.ts', 'async (jobs: JobWithMetadata<unknown>[]) => {');

// The queue-depth monitor is the only check that notices an event-driven queue which
// stopped draining. It must exist, be consumed, and be scheduled by the scheduler owner.
assertContains('src/jobs/worker.ts', 'await ensureQueueDepthMonitorQueue(boss);');
assertContains('src/jobs/worker.ts', 'handleQueueDepthMonitorJob({ logger: log })');
assertContainedBetween(
  'src/jobs/worker.ts',
  'if (schedulerEnabled()) {',
  '\n    }\n\n    await boss.work',
  'await scheduleQueueDepthMonitorJob(boss);',
);

// The worker's /health must consult something. It answered a hard-coded `{ ok: true }`
// for long enough that Coolify's health check was actively misleading.
assertContains('src/worker.ts', 'startWorkerHealthServer({');
assertContains('src/worker.ts', 'worker.isRunning()');

// The only dead-letter queue in the system had no consumer at all.
assertContains('src/jobs/worker.ts', 'TRANSACTION_ENRICHMENT_GPT_DLQ');
assertContains('src/jobs/worker.ts', 'handleDeadLetterJob(originQueue, job');

// Shutdown budgets must stay nested. Equal budgets meant a full pg-boss drain rejected
// the outer race and skipped closeDatabase() entirely (see jobs/worker.ts).
assertContains('src/worker.ts', 'afterClose: closeDatabase,');
assertContains('src/worker.ts', 'timeoutMs: WORKER_SHUTDOWN_TIMEOUT_MS,');

console.log('Worker deployment regression checks passed.');
