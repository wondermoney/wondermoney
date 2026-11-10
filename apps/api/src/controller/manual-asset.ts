import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { authedContext } from '@middleware/authed-context';
import {
  addValuation,
  type AssetViewer,
  createManualAsset as createManualAssetService,
  deleteManualAsset as deleteManualAssetService,
  deleteValuation,
  getManualAsset as getManualAssetService,
  listManualAssets as listManualAssetsService,
  listValuations,
  updateManualAsset as updateManualAssetService,
  updateValuation,
} from '@service/manual-asset/manual-asset.service';
import {
  createManualAssetSchema,
  createValuationSchema,
  manualAssetParamsSchema,
  updateManualAssetSchema,
  updateValuationSchema,
  valuationParamsSchema,
} from '@validators/manual-asset';
import { zParse } from '@validators/parser';

import { DI } from '../app';

export async function createManualAsset(req: Request, res: Response) {
  const { body } = await zParse(createManualAssetSchema, req);
  const asset = await createManualAssetService(DI.em, await viewerOf(req), body);
  return res.status(StatusCodes.CREATED).json({ asset });
}

export async function createManualAssetValuation(req: Request, res: Response) {
  const { body, params: { manualAssetId } } = await zParse(createValuationSchema, req);
  const { asset, replaced, valuation } = await addValuation(DI.em, await viewerOf(req), manualAssetId, body);
  // A second valuation for one day corrects the first: nothing new was created.
  return res.status(replaced ? StatusCodes.OK : StatusCodes.CREATED).json({ asset, valuation });
}

export async function deleteManualAsset(req: Request, res: Response) {
  const { params: { manualAssetId } } = await zParse(manualAssetParamsSchema, req);
  await deleteManualAssetService(DI.em, await viewerOf(req), manualAssetId);
  return res.sendStatus(StatusCodes.NO_CONTENT);
}

export async function deleteManualAssetValuation(req: Request, res: Response) {
  const { params: { manualAssetId, valuationId } } = await zParse(valuationParamsSchema, req);
  await deleteValuation(DI.em, await viewerOf(req), manualAssetId, valuationId);
  return res.sendStatus(StatusCodes.NO_CONTENT);
}

export async function getManualAsset(req: Request, res: Response) {
  const { params: { manualAssetId } } = await zParse(manualAssetParamsSchema, req);
  return res.json(await getManualAssetService(DI.em, await viewerOf(req), manualAssetId));
}

export async function listManualAssets(req: Request, res: Response) {
  return res.json(await listManualAssetsService(DI.em, await viewerOf(req)));
}

export async function listManualAssetValuations(req: Request, res: Response) {
  const { params: { manualAssetId } } = await zParse(manualAssetParamsSchema, req);
  return res.json({ valuations: await listValuations(DI.em, await viewerOf(req), manualAssetId) });
}

export async function updateManualAsset(req: Request, res: Response) {
  const { body, params: { manualAssetId } } = await zParse(updateManualAssetSchema, req);
  const asset = await updateManualAssetService(DI.em, await viewerOf(req), manualAssetId, body);
  return res.json({ asset });
}

export async function updateManualAssetValuation(req: Request, res: Response) {
  const { body, params: { manualAssetId, valuationId } } = await zParse(updateValuationSchema, req);
  return res.json(await updateValuation(DI.em, await viewerOf(req), manualAssetId, valuationId, body));
}

/** Who is asking, and the currency they read totals in. */
async function viewerOf(req: Request): Promise<AssetViewer> {
  const { appuserKey, tenantKey, user } = authedContext(req);
  await DI.em.populate(user, ['currencyKey']);
  return { appuserKey, currencyCode: user.currencyKey.code, tenantKey };
}
