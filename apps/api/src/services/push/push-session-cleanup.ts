import logger from '@utils/logger';

type Query = (sql: string, params: unknown[]) => Promise<unknown>;

/**
 * better-auth's `databaseHooks.session.delete.after`: a session that ends takes its devices with it,
 * so signing out (or being signed out by a revoke, a password change or account deletion) stops
 * pushes to that phone straight away. Never throws: ending a session must not fail on this.
 */
export async function removePushDevicesForSession(sessionId: string | undefined, query: Query): Promise<void> {
  if (!sessionId) return;
  try {
    await query('delete from public."push_device" where "session_id" = $1', [sessionId]);
  } catch (error) {
    logger.warn({ error }, 'Could not remove push devices for an ended session');
  }
}
