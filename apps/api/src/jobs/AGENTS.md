# BACKGROUND JOBS KNOWLEDGE BASE

## OVERVIEW

pg-boss queue, scheduler, and worker boundary. `src/worker.ts` owns the process;
`jobs/worker.ts#createWorker` ensures queues, conditionally registers schedules, and
binds handlers.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Worker composition | `worker.ts` | Registers every queue family and graceful stop |
| Queue contract | `*.queue.ts` | Names, retry/expiry policy, enqueue helpers |
| Job execution | `*.worker.ts` | Handler, lifecycle, error semantics |
| Scheduling | schedule helpers in `*.queue.ts`, `pgboss.config.ts` | Ownership controlled by environment flags |
| Durable progress | `background-operation*` | Correlation, claim, heartbeat, terminal state |
| Recovery | `recover-background-operations.ts` | Bounded operational recovery command |
| Worker wiring | `__tests__/worker.bootstrap.test.ts` | Queues, consumers, schedules, dead-letter queues, shutdown budget |

## CONVENTIONS

- Keep queue payloads explicit and serializable. Propagate correlation IDs through enqueue, claim, heartbeat, completion, and logs.
- Worker handlers run inside MikroORM `RequestContext`; preserve the injected dependency seams used by Vitest.
- Queue setup is idempotent. Existing pg-boss policies may not be fully updated after creation; only supported retry settings are refreshed.
- Schedule ownership is explicit. `PGBOSS_SCHEDULE`/supervision and feature flags must yield exactly one deployed scheduler owner.
- Background operations are the durable source of truth for retries and terminal outcomes.
- Shutdown stops health server, worker, then database; keep cleanup safe after partial startup.

## ANTI-PATTERNS

- Never register the same cron schedule from every replica.
- Never treat a missing correlation ID as a valid job.
- Never rethrow after a handler has intentionally recorded a terminal non-retryable `FAILED` state.
- Never add queue work directly to the HTTP process when it belongs to the separate worker target.
- Never change payload or queue names without checking producers, consumers, recovery, and `worker.bootstrap.test.ts` together.

## VERIFICATION

```bash
pnpm test src/jobs
pnpm type-check
```
