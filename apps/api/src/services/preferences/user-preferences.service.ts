import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { Appuser } from '@entity/Appuser';
import { NotFoundError } from '@utils/errors';
import { type UserPreferences, userPreferencesSchema } from '@validators/preferences';

export const USER_PREFERENCES_ERROR = {
  USER_NOT_FOUND: 'USER_PREFERENCES_USER_NOT_FOUND',
} as const;

/**
 * Read and write the `appuser.preferences` document for one user.
 *
 * The document is always parsed through `userPreferencesSchema` on the way in
 * and out: reads merge in defaults for keys an older row does not have, and
 * writes drop anything the schema does not know. A patch is a read-modify-write
 * under a row lock so two settings changed at once cannot drop each other.
 */
export class UserPreferencesService {
  private get em(): EntityManager {
    return this.injectedEm ?? DI.em;
  }

  constructor(private readonly injectedEm?: EntityManager) {}

  async getForAppuser(appuserKey: number): Promise<UserPreferences> {
    const appuser = await this.em.findOne(Appuser, { appuserKey });
    if (!appuser) throw new NotFoundError(USER_PREFERENCES_ERROR.USER_NOT_FOUND);
    return userPreferencesSchema.parse(appuser.preferences);
  }

  async patchForAppuser(appuserKey: number, patch: Partial<UserPreferences>): Promise<UserPreferences> {
    return this.em.transactional(async (tx) => {
      const appuser = await tx.findOne(Appuser, { appuserKey }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!appuser) throw new NotFoundError(USER_PREFERENCES_ERROR.USER_NOT_FOUND);
      const next = userPreferencesSchema.parse({ ...userPreferencesSchema.parse(appuser.preferences), ...patch });
      appuser.preferences = next;
      await tx.flush();
      return next;
    });
  }
}

export const userPreferencesService = new UserPreferencesService();
