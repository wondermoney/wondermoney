import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { isInstanceSetUp } from '@service/auth/instance-admin.service';
import logger from '@utils/logger';

/**
 * Whether this server is still waiting for its first account (`GET /v1/instance`
 * `setupRequired`). The web app then sends every signed-out visitor to its setup page.
 *
 * Once the answer is false it stays false, so the process remembers it and stops asking.
 * Until then every call asks the database. A failed lookup answers false without remembering
 * it: the clients then show their usual sign-in, never a setup page on a server that has users.
 */
export function setupRequiredCheck(isSetUp: () => Promise<boolean>): () => Promise<boolean> {
  let setUp = false;
  return async () => {
    if (setUp) return false;
    try {
      setUp = await isSetUp();
    } catch (error) { // no-excuse-ok: catch -- the instance description must answer while the database is down
      logger.warn({ error }, 'Could not tell whether this server has any account yet');
      return false;
    }
    return !setUp;
  };
}

/**
 * The setup check over the database: setup is required while the instance is not set up by the
 * rule the first-account admin grant uses too (`isInstanceSetUp`: no app user other than the demo
 * account has ever existed), so the setup page shows exactly while that grant is open.
 */
export function setupRequiredFromDatabase(em: () => EntityManager): () => Promise<boolean> {
  return setupRequiredCheck(() => isInstanceSetUp(em()));
}

export const isSetupRequired = setupRequiredFromDatabase(() => {
  if (!DI.orm) throw new Error('The database is not connected');
  return DI.orm.em.fork();
});
