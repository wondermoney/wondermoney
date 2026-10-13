import type { Request, Response } from 'express';

import { zParse } from '@app/validators/parser';
import { confirmPortfolioImportAssetMappingsRequestSchema, confirmPortfolioImportColumnMappingRequestSchema, confirmPortfolioImportSessionRequestSchema, getPortfolioImportSessionPreviewRequestSchema, parsePortfolioImportSessionRequestSchema, suggestPortfolioImportColumnMappingRequestSchema } from '@app/validators/portfolio';
import portfolioCsvColumnMappingService from '@service/portfolio/portfolio-csv-column-mapping.service';
import portfolioImportAssetMappingService from '@service/portfolio/portfolio-import-asset-mapping.service';
import portfolioImportSessionPreviewService from '@service/portfolio/portfolio-import-session-preview.service';
import portfolioImportSessionTransitions from '@service/portfolio/portfolio-import-session-transitions';
import portfolioImportSessionService from '@service/portfolio/portfolio-import-session.service';
import { BadRequestError, NotFoundError } from '@utils/errors';

export async function confirmPortfolioImportSession(req: Request, res: Response) {
  const { params: { importSessionId } } = await zParse(confirmPortfolioImportSessionRequestSchema, req);
  const appuser = req.user;
  const tenant = req.tenant;
  if (!appuser) throw new BadRequestError('Unauthorized');
  if (!tenant) throw new NotFoundError('Tenant not found');

  const outcome = await portfolioImportSessionTransitions.requestConfirm({ appuser, importSessionId, tenant }, { enqueue: req.enqueue });
  return res.status(202).json(outcome);
}

export async function confirmPortfolioImportSessionAssetMappings(req: Request, res: Response) {
  const { body: { decisions }, params: { importSessionId } } = await zParse(confirmPortfolioImportAssetMappingsRequestSchema, req);
  if (!req.user) throw new BadRequestError('Unauthorized');
  if (!req.tenant) throw new NotFoundError('Tenant not found');

  const session = await portfolioImportSessionService.getOwnedSession({ appuser: req.user, importSessionId, tenant: req.tenant });
  if (portfolioImportSessionService.isExpired(session)) throw new NotFoundError('Import session has expired');

  const result = await portfolioImportAssetMappingService.confirmAssetMappings({ appuser: req.user, decisions, importSessionId, tenant: req.tenant });
  return res.status(200).json(result);
}

export async function confirmPortfolioImportSessionColumnMapping(req: Request, res: Response) {
  const { body: { columnMapping, derivedValues, fixedValues, layout, transformations }, params: { importSessionId } } = await zParse(confirmPortfolioImportColumnMappingRequestSchema, req);
  if (!req.user) throw new BadRequestError('Unauthorized');
  if (!req.tenant) throw new NotFoundError('Tenant not found');

  const session = await portfolioImportSessionService.getOwnedSession({ appuser: req.user, importSessionId, tenant: req.tenant });
  if (portfolioImportSessionService.isExpired(session)) throw new NotFoundError('Import session has expired');

  const result = await portfolioCsvColumnMappingService.confirmColumnMapping({ appuser: req.user, columnMapping, derivedValues, fixedValues, importSessionId, layout, tenant: req.tenant, transformations });
  return res.status(200).json({ importSessionId: result.importSessionId, status: result.status, summary: result });
}

export async function getPortfolioImportSessionPreview(req: Request, res: Response) {
  const { params: { importSessionId }, query: { limit } } = await zParse(getPortfolioImportSessionPreviewRequestSchema, req);
  if (!req.user) throw new BadRequestError('Unauthorized');
  if (!req.tenant) throw new NotFoundError('Tenant not found');

  const preview = await portfolioImportSessionPreviewService.getPreview({ appuser: req.user, importSessionId, limit, tenant: req.tenant });
  return res.status(200).json(preview);
}

export async function suggestPortfolioImportSessionColumnMapping(req: Request, res: Response) {
  const { params: { importSessionId } } = await zParse(suggestPortfolioImportColumnMappingRequestSchema, req);
  if (!req.user) throw new BadRequestError('Unauthorized');
  if (!req.tenant) throw new NotFoundError('Tenant not found');

  const result = await portfolioCsvColumnMappingService.suggestColumnMapping({ appuser: req.user, importSessionId, tenant: req.tenant });
  return res.status(200).json({ columnMapping: result.columnMapping, importSessionId: result.importSessionId, mappingSource: result.mappingSource, status: result.status, warning: result.warning });
}

export async function triggerPortfolioImportSessionParse(req: Request, res: Response) {
  const { params: { importSessionId } } = await zParse(parsePortfolioImportSessionRequestSchema, req);
  const appuser = req.user;
  const tenant = req.tenant;
  if (!appuser) throw new BadRequestError('Unauthorized');
  if (!tenant) throw new NotFoundError('Tenant not found');

  const outcome = await portfolioImportSessionTransitions.requestParse({ appuser, importSessionId, tenant }, { enqueue: req.enqueue });
  return res.status(202).json(outcome);
}
