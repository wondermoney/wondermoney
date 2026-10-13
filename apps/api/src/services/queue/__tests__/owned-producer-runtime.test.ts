import { EventEmitter } from 'node:events';

import type { Pool, PoolClient, PoolConfig, QueryResult } from 'pg';
import { PgBoss } from 'pg-boss';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOwnedProducerRuntime } from '@service/queue/owned-producer-runtime';

const env = {
  DB_DATABASE: 'test',
  DB_HOST: 'localhost',
  DB_PASSWORD: 'test',
  DB_PORT: '5432',
  DB_USERNAME: 'test',
  PGBOSS_MIGRATE: 'true',
  PGBOSS_SCHEDULE: 'true',
  PGBOSS_SUPERVISE: 'true',
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

class ScriptedClient extends EventEmitter {
  public readonly query = vi.fn<(text: string, values?: unknown[]) => Promise<QueryResult>>();
  public readonly release = vi.fn<(error?: boolean | Error) => void>();
}

class ScriptedPool extends EventEmitter {
  public readonly clients: ScriptedClient[] = [];
  public readonly connect = vi.fn((): Promise<PoolClient> => {
    const client = new ScriptedClient();
    this.clients.push(client);
    client.query.mockImplementation((text) => this.onQuery(text, client));
    return Promise.resolve(client as unknown as PoolClient);
  });
  public readonly end = vi.fn<() => Promise<void>>(() => Promise.resolve());

  public constructor(private readonly onQuery: (text: string, client: ScriptedClient) => Promise<QueryResult>) {
    super();
  }
}

const queryResult = (rows: unknown[] = []): QueryResult => ({ rows } as QueryResult);
const scriptNormalStartup = (text: string): Promise<QueryResult> => {
  if (text.includes('to_regclass')) return Promise.resolve(queryResult([{ name: 'pgboss.version' }]));
  if (text.includes('.version')) {
    return Promise.resolve(queryResult([{ version: 30 }]));
  }
  return Promise.resolve(queryResult([]));
};

const createRuntime = (pool: ScriptedPool) =>
  createOwnedProducerRuntime({
    createBoss: (options) => {
      expect(options.migrate).toBe(false);
      expect(options.supervise).toBe(false);
      expect(options.schedule).toBe(false);
      return new PgBoss(options);
    },
    createPool: (options: PoolConfig) => {
      expect(options.connectionTimeoutMillis).toBe(5000);
      return pool as unknown as Pool;
    },
    env,
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('owned producer runtime', () => {
  it('starts a real pg-boss on the dedicated pool and stops its manager timer on disposal', async () => {
    vi.useFakeTimers();
    const pool = new ScriptedPool(async (text) => scriptNormalStartup(text));
    const runtime = createRuntime(pool);

    await runtime.start();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(pool.clients.length).toBe(3);

    await runtime.dispose();

    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(pool.clients.every((client) => client.release.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects contractor startup on disposal and closes SQL admission immediately', async () => {
    vi.useFakeTimers();
    const pendingQuery = deferred<QueryResult>();
    const enteredQuery = deferred<void>();
    const pool = new ScriptedPool(async (_text) => {
      enteredQuery.resolve();
      return pendingQuery.promise;
    });
    const runtime = createRuntime(pool);
    const startup = runtime.start();
    await enteredQuery.promise;

    const disposing = runtime.dispose(new Error('shutdown requested'));
    await expect(startup).rejects.toThrow('shutdown requested');
    await disposing;

    expect(pool.clients[0]?.release).toHaveBeenCalledTimes(1);
    expect(pool.clients[0]?.release).toHaveBeenCalledWith(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up after a contractor query rejects during startup', async () => {
    vi.useFakeTimers();
    const pool = new ScriptedPool(() => Promise.reject(new Error('contractor query failed')));
    const runtime = createRuntime(pool);

    await expect(runtime.start()).rejects.toThrow('contractor query failed');
    await runtime.dispose();

    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(pool.clients[0]?.release).toHaveBeenCalledTimes(1);
    expect(pool.clients[0]?.release).toHaveBeenCalledWith(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes its temporary error listener after reuse and preserves the pool idle listener', async () => {
    vi.useFakeTimers();
    const reusedClient = new ScriptedClient();
    const pool = new ScriptedPool(async (text) => scriptNormalStartup(text));
    const poolIdleErrorListener = vi.fn();
    reusedClient.on('error', poolIdleErrorListener);
    pool.connect.mockImplementation(() => {
      reusedClient.query.mockImplementation((text) => scriptNormalStartup(text));
      pool.clients.push(reusedClient);
      return Promise.resolve(reusedClient as unknown as PoolClient);
    });
    const runtime = createRuntime(pool);

    await runtime.start();

    expect(pool.clients).toHaveLength(3);
    expect(reusedClient.listenerCount('error')).toBe(1);
    expect(reusedClient.listeners('error')).toContain(poolIdleErrorListener);

    await runtime.dispose();
  });

  it('destroys a checkout that arrives after cancellation without issuing SQL', async () => {
    vi.useFakeTimers();
    const lateCheckout = deferred<PoolClient>();
    const pool = new ScriptedPool(async (text) => scriptNormalStartup(text));
    pool.connect.mockReturnValueOnce(lateCheckout.promise);
    const runtime = createRuntime(pool);
    const startup = runtime.start();
    const disposing = runtime.dispose();

    await expect(startup).rejects.toThrow('runtime disposed');
    await disposing;
    const lateClient = new ScriptedClient();
    lateClient.query.mockResolvedValue(queryResult());
    lateCheckout.resolve(lateClient as unknown as PoolClient);
    await Promise.resolve();
    await Promise.resolve();

    expect(lateClient.query).not.toHaveBeenCalled();
    expect(lateClient.release).toHaveBeenCalledTimes(1);
    expect(lateClient.release).toHaveBeenCalledWith(true);
  });

  it.each(['resolve', 'reject'] as const)('releases a cancelled running query only once when it later %s', async (settlement) => {
    vi.useFakeTimers();
    const pendingQuery = deferred<QueryResult>();
    const enteredQueueQuery = deferred<void>();
    const pool = new ScriptedPool(async (text) => {
      if (text.includes('to_regclass')) {
        return queryResult([{ name: 'pgboss.version' }]);
      }
      if (text.includes('.version')) {
        return queryResult([{ version: 30 }]);
      }
      enteredQueueQuery.resolve();
      return pendingQuery.promise;
    });
    const runtime = createRuntime(pool);
    const startup = runtime.start();
    await enteredQueueQuery.promise;

    const disposing = runtime.dispose();
    await disposing;
    const queueClient = pool.clients.at(-1);
    expect(queueClient?.release).toHaveBeenCalledTimes(1);
    expect(queueClient?.release).toHaveBeenCalledWith(true);

    if (settlement === 'resolve') pendingQuery.resolve(queryResult([]));
    else pendingQuery.reject(new Error('late query failure'));
    await expect(startup).resolves.toBeUndefined();
    await Promise.resolve();

    expect(queueClient?.release).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('attempts manager shutdown even if ending the dedicated pool fails', async () => {
    vi.useFakeTimers();
    const pool = new ScriptedPool(async (text) => scriptNormalStartup(text));
    pool.end.mockRejectedValue(new Error('pool end failed'));
    const runtime = createRuntime(pool);

    await runtime.start();
    await expect(runtime.dispose()).rejects.toThrow('pool end failed');

    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('memoizes start and dispose operations', async () => {
    vi.useFakeTimers();
    const pool = new ScriptedPool(async (text) => scriptNormalStartup(text));
    const runtime = createRuntime(pool);
    const startA = runtime.start();
    const startB = runtime.start();
    expect(startA).toBe(startB);
    await startA;

    const disposeA = runtime.dispose();
    const disposeB = runtime.dispose();
    expect(disposeA).toBe(disposeB);
    await disposeA;
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('ends the pool asynchronously when boss construction throws, without masking the constructor error', async () => {
    const pool = new ScriptedPool(async (text) => scriptNormalStartup(text));
    const constructionError = new Error('boss constructor failed');
    pool.end.mockRejectedValue(new Error('pool cleanup failed'));
    const createRuntimeWithFailingBoss = () =>
      createOwnedProducerRuntime({
        createBoss: () => { throw constructionError; },
        createPool: () => pool as unknown as Pool,
        env,
      });

    expect(createRuntimeWithFailingBoss).toThrow(constructionError);
    expect(pool.end).not.toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();

    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
