import { createBetterAuthUser, deleteBetterAuthUserByEmail } from '@service/auth/better-auth';

/** Seed/test user creation. Idempotent across re-seeds: deletes any stale better-auth user with
 *  this email first, so re-running seeds always ends up with a fresh credential + known password. */
export async function createUser({ email, name, password }: { email: string; name?: string; password: string }): Promise<{ id: string }> {
  await deleteBetterAuthUserByEmail(email);
  return createBetterAuthUser({ email, name, password });
}
