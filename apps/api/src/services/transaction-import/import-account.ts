import type { Account } from '@entity/Account';
import { ConflictError } from '@utils/errors';

/**
 * A closed account takes no new transactions from a file: the upload link, the preview and every
 * import into one are refused (409). Who may import is `account-access.ts`'s rule.
 */
export function assertOpenForImport(account: Pick<Account, 'closed'>): void {
  if (account.closed) throw new ConflictError('This account is closed');
}
