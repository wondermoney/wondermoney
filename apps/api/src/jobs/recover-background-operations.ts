import dotenv from 'dotenv';

import type { RecoverOnceInput } from '@service/operations/background-operation-recovery.service';
import { createOwnedProducerRuntime, type OwnedProducerRuntime } from '@service/queue/owned-producer-runtime';
import logger from '@utils/logger';

dotenv.config({ quiet: true });

interface RecoveryCommandDeps {
  app?: { connect: () => Promise<void>; orm?: { close: () => Promise<void> } };
  createRuntime?: () => OwnedProducerRuntime;
  logger?: Pick<typeof logger, 'error' | 'info' | 'warn'>;
  recoveryService?: { recoverOnce: (input: RecoverOnceInput) => Promise<Record<string, number>> };
  runtime?: OwnedProducerRuntime;
}

export async function runRecoveryCommand(deps: RecoveryCommandDeps = {}) {
  const app = deps.app ?? new (await import('@app/app')).default();
  const log = deps.logger ?? logger;
  const service = deps.recoveryService ?? (await import('@service/operations/background-operation-recovery.service')).default;
  let runtime: OwnedProducerRuntime | undefined = deps.runtime;

  try {
    await app.connect();
    runtime ??= (deps.createRuntime ?? createOwnedProducerRuntime)();
    await runtime.start();
    const summary = await service.recoverOnce({
      boss: runtime.boss,
      limit: 50,
      logger: log,
      now: new Date(),
    });
    log.info({ summary }, 'Background operation recovery finished');
    return summary;
  } catch (error) {
    log.error({ error }, 'Background operation recovery failed');
    throw error;
  } finally {
    try {
      await runtime?.dispose();
    } catch (error) {
      log.error({ error }, 'Background operation recovery runtime disposal failed');
    }
    try {
      await app.orm?.close();
    } catch (error) {
      log.error({ error }, 'Background operation recovery ORM close failed');
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runRecoveryCommand();
}
