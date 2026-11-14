import { type InstanceEnableBankingCredential, InstanceEnableBankingCredentialError, loadInstanceEnableBankingCredential } from '@config/enable-banking-instance';
import logger from '@utils/logger';

let cached: undefined | { key: string; value: InstanceEnableBankingCredential | null };

/**
 * The instance-wide Enable Banking credential for this process (`config/enable-banking-instance.ts`),
 * or null when it is off. Read once per configuration and kept in memory. The start-up check
 * refuses a broken one, so a failure here means the file changed under a running process: it is
 * logged (the path, never the contents) and the instance credential counts as off.
 *
 * Who may use it is decided by `instance-credential-policy.ts`.
 */
export function instanceEnableBankingCredential(): InstanceEnableBankingCredential | null {
  const source = {
    ENABLE_BANKING_APP_ID: process.env['ENABLE_BANKING_APP_ID'],
    ENABLE_BANKING_PRIVATE_KEY_FILE: process.env['ENABLE_BANKING_PRIVATE_KEY_FILE'],
  };
  const key = JSON.stringify([source.ENABLE_BANKING_APP_ID ?? '', source.ENABLE_BANKING_PRIVATE_KEY_FILE ?? '']);
  if (cached?.key === key) return cached.value;

  let value: InstanceEnableBankingCredential | null = null;
  try {
    value = loadInstanceEnableBankingCredential(source);
  } catch (error) {
    if (!(error instanceof InstanceEnableBankingCredentialError)) throw error;
    logger.error({ problem: error.message }, 'Instance Enable Banking credential is unusable; bank sync needs each user\'s own credential');
  }
  cached = { key, value };
  return value;
}
