import type { Job } from 'pg-boss';

import type { PortfolioCsvParsePreviewJobPayload } from '@app/jobs/portfolio-csv-parse-preview.queue';
import { PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';
import PortfolioCsvParsePreviewService from '@service/portfolio/portfolio-csv-parse-preview.service';
import portfolioImportSessionService from '@service/portfolio/portfolio-import-session.service';
import logger from '@utils/logger';

export const handlePortfolioCsvParsePreviewJob = async (
  job: Job<PortfolioCsvParsePreviewJobPayload>,
  deps: { parsePreviewService?: Pick<PortfolioCsvParsePreviewService, 'parseImportSession'> } = {},
) => {
  const { importSessionId } = job.data;
  if (!Number.isSafeInteger(importSessionId) || importSessionId <= 0) return false;
  const parsePreviewService = deps.parsePreviewService ?? new PortfolioCsvParsePreviewService();

  try {
    return await parsePreviewService.parseImportSession({ importSessionId });
  } catch (error) {
    logger.error({ error, importSessionId, jobId: job.id }, 'Portfolio CSV parse preview worker failed');
    try {
      await portfolioImportSessionService.markWorkerFailure({
        error,
        expectedStatus: PortfolioImportSessionStatus.PARSING,
        importSessionId,
        summaryKey: 'parseWorkerError',
      });
    } catch (markError) {
      logger.error({ error, importSessionId, jobId: job.id, markError }, 'Failed to mark portfolio CSV parse preview worker failure');
    }
    throw error;
  }
};
