import type { Request, Response } from 'express';

import { DI } from '@app/database/di';
import { zParse } from '@app/validators/parser';
import { authedContext } from '@middleware/authed-context';
import { DataExportService } from '@service/data-export/data-export.service';
import logger from '@utils/logger';
import { dataExportRequestSchema, startDataExportSchema } from '@validators/data-export';

/**
 * `POST /v1/user/me/exports`: start a full data export, or return the one in progress. An optional
 * `password` in the body protects the archive; it is handed to the export and never logged.
 */
export async function startDataExport(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const { body } = await zParse(startDataExportSchema, req);
  const service = new DataExportService(DI.em, { enqueue: req.enqueue });
  const { created, export: view } = await service.start({ appuserKey, tenantKey }, body?.password === undefined ? {} : { password: body.password });
  return res.status(created ? 202 : 200).json({ export: view });
}

/** `GET /v1/user/me/exports`: the person's exports of the last 24 hours, newest first. */
export async function listDataExports(req: Request, res: Response) {
  const { appuserKey } = authedContext(req);
  const exports = await new DataExportService(DI.em).list(appuserKey);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ exports });
}

/** `GET /v1/user/me/exports/:exportId`: status, and a short-lived download link once stored. */
export async function getDataExport(req: Request, res: Response) {
  const { appuserKey } = authedContext(req);
  const { params: { exportId } } = await zParse(dataExportRequestSchema, req);
  const view = await new DataExportService(DI.em).get(appuserKey, exportId);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ export: view });
}

/**
 * `GET /v1/user/me/exports/:exportId/download`: a stored export redirects to its link; without
 * file storage the zip is built straight into this response.
 */
export async function downloadDataExport(req: Request, res: Response) {
  const { appuserKey } = authedContext(req);
  const { params: { exportId } } = await zParse(dataExportRequestSchema, req);
  const service = new DataExportService(DI.em);
  try {
    await service.download(appuserKey, exportId, res, {
      onRedirect: (url) => {
        res.setHeader('Cache-Control', 'no-store');
        res.redirect(302, url);
      },
      onStart: (fileName) => {
        res.status(200);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Cache-Control', 'no-store');
      },
    });
  } catch (error) {
    if (!res.headersSent) throw error;
    // Half a zip is already on the wire: cut the connection so the client sees a failed download.
    logger.error({ error, exportId }, 'Data export stream failed');
    res.destroy(error instanceof Error ? error : undefined);
  }
}
