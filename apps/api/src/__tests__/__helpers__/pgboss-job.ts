/**
 * Typed pg-boss job payload builders for worker tests.
 *
 * Replaces `{ data: payload, id, retryCount, retryLimit } as never` literals with
 * a `pgBossJob<T>(payload, options?)` helper that returns the correct
 * `PgBoss.Job<T>` shape with sane defaults.
 */
import type { Job } from 'pg-boss';
import { vi } from 'vitest';

export interface PgBossJobOptions {
  expireInSeconds?: number;
  id?: string;
  name?: string;
  retryCount?: number;
  retryLimit?: number;
  singletonKey?: string;
}

export function pgBossJob<T>(payload: T, options: PgBossJobOptions = {}): Job<T> {
  return {
    data: payload,
    expire: new Date(Date.now() + 60_000),
    expireInSeconds: options.expireInSeconds ?? null,
    id: options.id ?? `job-${Math.random().toString(36).slice(2, 10)}`,
    insertedon: new Date(),
    keepUntil: new Date(Date.now() + 86_400_000),
    name: options.name ?? 'job',
    retryCount: options.retryCount ?? 0,
    retryleft: options.retryLimit ?? 0,
    retryLimit: options.retryLimit ?? 0,
    singletonKey: options.singletonKey ?? null,
    state: 'created',
  } as unknown as Job<T>;
}

export function pgBossJobMock(handler: ReturnType<typeof vi.fn>) {
  return { data: undefined, handler } as unknown as Job;
}
