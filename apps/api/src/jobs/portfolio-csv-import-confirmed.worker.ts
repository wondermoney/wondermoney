import type { Job } from 'pg-boss';

import { PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';
import portfolioImportFinalizeService from '@service/portfolio/portfolio-import-finalize.service';
import portfolioImportMaintenanceService from '@service/portfolio/portfolio-import-maintenance.service';
import portfolioImportSessionService from '@service/portfolio/portfolio-import-session.service';
import type { Enqueue } from '@service/queue/enqueue';
import logger from '@utils/logger';

import type { PortfolioCsvImportConfirmedJobPayload } from './portfolio-csv-import-confirmed.queue';

const isValidPayload = (payload: Partial<PortfolioCsvImportConfirmedJobPayload>) => {
  const { correlationId, importSessionId } = payload;
  if (typeof importSessionId !== 'number' || !Number.isSafeInteger(importSessionId) || importSessionId <= 0) return false;
  return typeof correlationId === 'string' && correlationId.startsWith(`portfolio.csv-import-confirmed:${importSessionId}:`);
};

export const handlePortfolioCsvImportConfirmedJob = async (
  job: Job<PortfolioCsvImportConfirmedJobPayload>,
  deps: { enqueue: Enqueue; finalizeService?: typeof portfolioImportFinalizeService; maintenanceService?: typeof portfolioImportMaintenanceService },
) => {
  if (!isValidPayload(job.data)) throw new Error('Invalid portfolio csv import confirmed job payload');
  const { importSessionId } = job.data;
  const finalizeService = deps.finalizeService ?? portfolioImportFinalizeService;
  const maintenanceService = deps.maintenanceService ?? portfolioImportMaintenanceService;

  try {
    return await finalizeService.finalizeImportSession(
      { importSessionId },
      { triggerMaintenance: (input) => maintenanceService.triggerPostImportMaintenance(input, { enqueue: deps.enqueue }) },
    );
  } catch (error) {
    logger.error({ error, importSessionId, jobId: job.id }, 'Portfolio CSV import confirmed worker failed');
    try {
      await portfolioImportSessionService.markWorkerFailure({
        error,
        expectedStatus: PortfolioImportSessionStatus.IMPORTING,
        importSessionId,
        summaryKey: 'importWorkerError',
      });
    } catch (markError) {
      logger.error({ error, importSessionId, jobId: job.id, markError }, 'Failed to mark portfolio CSV import confirmed worker failure');
    }
    throw error;
  }
};
