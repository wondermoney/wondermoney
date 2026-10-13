import { Pool, type PoolClient, type PoolConfig, type QueryResult } from 'pg';
import { type ConstructorOptions, type Db, PgBoss } from 'pg-boss';

import { buildPgBossConfig } from '@app/jobs/pgboss.config';
import logger from '@utils/logger';

export type OwnedProducerBoss = Pick<ProducerBoss, 'createQueue' | 'findJobs' | 'send' | 'sendAfter' | 'updateQueue'>;
export interface OwnedProducerRuntime {
  readonly boss: OwnedProducerBoss;
  dispose(reason?: Error): Promise<void>;
  start(): Promise<void>;
}
export interface OwnedProducerRuntimeDependencies {
  createBoss?: (options: BossOptions) => ProducerBoss;
  createPool?: PoolFactory;
  env?: Partial<Record<string, string | undefined>>;
}
type BossOptions = ConstructorOptions & { db: Db };
interface CheckedOutClient {
  client: PoolClient;
  release(destroy?: boolean): void;
}

type PoolFactory = (config: ProducerPoolConfig) => ProducerPool;

type ProducerBoss = Pick<PgBoss, 'createQueue' | 'findJobs' | 'on' | 'send' | 'sendAfter' | 'start' | 'stop' | 'updateQueue'>;

type ProducerPool = Pick<Pool, 'connect' | 'end' | 'on'>;

type ProducerPoolConfig = PoolConfig & { connectionString: string; connectionTimeoutMillis: 5000 };

const safeLog = (error: unknown, message: string): void => {
  try {
    logger.error({ error }, message);
  } catch {
    // A diagnostic listener must never turn a client/pool error into an uncaught exception.
  }
};

const asError = (reason: unknown): Error => reason instanceof Error ? reason : new Error(String(reason));

/**
 * An HTTP-process-owned pg-boss instance backed by its own Pool. Its wrapped database adapter
 * admits SQL only while live and owns every checked-out client until query settlement or disposal.
 */
export const createOwnedProducerRuntime = (dependencies: OwnedProducerRuntimeDependencies = {}): OwnedProducerRuntime => {
  const config = buildPgBossConfig(dependencies.env);
  const poolConfig: ProducerPoolConfig = {
    connectionString: config.connectionString,
    connectionTimeoutMillis: 5000,
  };
  const poolFactory: PoolFactory = dependencies.createPool ?? ((options) => new Pool(options));
  const pool = poolFactory(poolConfig);
  pool.on('error', (error: Error) => { safeLog(error, 'Owned producer database pool error'); });

  let disposing = false;
  let startPromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;
  let cancelPending!: (reason: Error) => void;
  const cancellation = new Promise<never>((_resolve, reject) => {
    cancelPending = reject;
  });
  // The race is attached only to active SQL calls, but cancellation itself may happen before one.
  void cancellation.catch(() => undefined);
  const checkedOut = new Set<CheckedOutClient>();

  const database: Db = {
    async executeSql(text, values) {
      if (disposing) throw new Error('OwnedProducerRuntime: SQL admission is closed');

      const operation = (async (): Promise<QueryResult> => {
        const client = await pool.connect();
        const onClientError = (error: Error): void => {
          safeLog(error, 'Owned producer database client error');
        };
        const checkout: CheckedOutClient = {
          client,
          release(destroy = false) {
            // Disposal and query settlement can race; the set membership is the release-once guard.
            if (!checkedOut.delete(checkout)) return;
            try {
              client.release(destroy);
            } catch (error) {
              safeLog(error, 'Owned producer database client release failed');
            } finally {
              // Release first so pg.Pool can establish its idle-client error handler before ours is removed.
              client.removeListener('error', onClientError);
            }
          },
        };
        client.on('error', onClientError);
        checkedOut.add(checkout);

        // The phase can change while pool.connect() is pending.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (disposing) {
          checkout.release(true);
          throw new Error('OwnedProducerRuntime: SQL admission is closed');
        }

        try {
          return await client.query(text, values);
        } catch (error) {
          checkout.release(true);
          throw error;
        } finally {
          checkout.release();
        }
      })();

      return await Promise.race([operation, cancellation]);
    },
  };

  const bossFactory = dependencies.createBoss ?? ((options) => new PgBoss(options));
  let boss: ProducerBoss;
  try {
    boss = bossFactory({
      ...config,
      db: database,
      migrate: false,
      schedule: false,
      supervise: false,
    });
  } catch (error) {
      void Promise.resolve()
        .then(() => pool.end())
        .catch((cleanupError: unknown) => {
          safeLog(cleanupError, 'Owned producer pool cleanup after boss construction failed');
        });
    throw error;
  }

  boss.on('error', (error: Error) => { safeLog(error, 'Owned producer pg-boss error'); });

  const ownedBoss: OwnedProducerBoss = {
    createQueue: boss.createQueue.bind(boss),
    findJobs: boss.findJobs.bind(boss),
    send: boss.send.bind(boss),
    sendAfter: boss.sendAfter.bind(boss),
    updateQueue: boss.updateQueue.bind(boss),
  };

  const manager: OwnedProducerRuntime = {
    boss: ownedBoss,
    dispose(reason = new Error('OwnedProducerRuntime: runtime disposed')) {
      if (disposePromise) return disposePromise;

      // Close admission and destroy outstanding checkouts before starting any asynchronous cleanup.
      disposing = true;
      cancelPending(reason);
      for (const checkout of [...checkedOut]) checkout.release(true);

      let poolEnd: Promise<void>;
      try {
        poolEnd = Promise.resolve(pool.end());
      } catch (error) {
        poolEnd = Promise.reject(asError(error));
      }
      const settleStartup = startPromise ? startPromise.then(() => undefined, () => undefined) : Promise.resolve();
      const bossStop = settleStartup.then(() => boss.stop({ close: false, graceful: false }));
      disposePromise = Promise.allSettled([poolEnd, bossStop]).then((results) => {
        const errors: Error[] = [];
        for (const result of results) {
          if (result.status === 'rejected') errors.push(asError(result.reason));
        }
        if (errors.length === 1) {
          const [error] = errors;
          if (error) throw error;
        }
        if (errors.length > 1) throw new AggregateError(errors, 'OwnedProducerRuntime cleanup failed');
      });
      return disposePromise;
    },
    start() {
      if (disposing) return Promise.reject(new Error('OwnedProducerRuntime: runtime is disposing'));
      startPromise ??= boss.start().then(() => undefined);
      return startPromise;
    },
  };

  return manager;
};
