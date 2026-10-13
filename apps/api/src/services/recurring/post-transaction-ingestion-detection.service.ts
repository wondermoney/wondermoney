import { detectRecurringCandidatesForTenant } from '@service/recurring/recurring-detection.service';
import logger from '@utils/logger';

export type RecurringDetectionIngestionSource = 'account-initial-sync' | 'manual-transaction' | 'transaction-import';

export async function triggerRecurringDetectionAfterTransactionIngestion(tenantKey: number, source: RecurringDetectionIngestionSource): Promise<void> {
  try {
    await detectRecurringCandidatesForTenant(tenantKey);
  } catch (error) {
    logger.warn({ error, source, tenantKey }, 'Recurring detection failed after transaction ingestion');
  }
}
