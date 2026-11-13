import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { authedContext } from '@middleware/authed-context';
import {
  addWalletAddress as addWalletAddressService,
  createCryptoWallet as createCryptoWalletService,
  removeWalletAddress as removeWalletAddressService,
  requestWalletSync,
  setWalletTokenTracked,
  updateWalletAddress as updateWalletAddressService,
} from '@service/crypto-wallet/crypto-wallet.service';
import type { AssetViewer } from '@service/manual-asset/manual-asset.service';
import {
  addWalletAddressSchema,
  createCryptoWalletSchema,
  updateWalletAddressSchema,
  updateWalletTokenSchema,
  walletAddressParamsSchema,
  walletParamsSchema,
} from '@validators/crypto-wallet';
import { zParse } from '@validators/parser';

import { DI } from '../app';

/*
 * Crypto wallets: manual assets valued from public addresses. Renaming, privacy, archiving and
 * deleting a wallet go through the manual-asset routes, like any asset.
 */

export async function addWalletAddress(req: Request, res: Response) {
  const { body, params: { manualAssetId } } = await zParse(addWalletAddressSchema, req);
  const wallet = await addWalletAddressService(DI.em, await viewerOf(req), manualAssetId, body, { enqueue: req.enqueue });
  return res.status(StatusCodes.CREATED).json({ wallet });
}

export async function createCryptoWallet(req: Request, res: Response) {
  const { body } = await zParse(createCryptoWalletSchema, req);
  return res.status(StatusCodes.CREATED).json(await createCryptoWalletService(DI.em, await viewerOf(req), body, { enqueue: req.enqueue }));
}

export async function removeWalletAddress(req: Request, res: Response) {
  const { params: { addressId, manualAssetId } } = await zParse(walletAddressParamsSchema, req);
  return res.json({ wallet: await removeWalletAddressService(DI.em, await viewerOf(req), manualAssetId, addressId, { enqueue: req.enqueue }) });
}

export async function syncCryptoWallet(req: Request, res: Response) {
  const { params: { manualAssetId } } = await zParse(walletParamsSchema, req);
  await requestWalletSync(DI.em, await viewerOf(req), manualAssetId, { enqueue: req.enqueue });
  return res.status(StatusCodes.ACCEPTED).json({ queued: true });
}

export async function updateWalletAddress(req: Request, res: Response) {
  const { body, params: { addressId, manualAssetId } } = await zParse(updateWalletAddressSchema, req);
  return res.json({ wallet: await updateWalletAddressService(DI.em, await viewerOf(req), manualAssetId, addressId, body) });
}

export async function updateWalletToken(req: Request, res: Response) {
  const { body: { tracked }, params: { manualAssetId, tokenId } } = await zParse(updateWalletTokenSchema, req);
  return res.json({ wallet: await setWalletTokenTracked(DI.em, await viewerOf(req), manualAssetId, tokenId, tracked, { enqueue: req.enqueue }) });
}

/** Who is asking, and the currency they read totals in. */
async function viewerOf(req: Request): Promise<AssetViewer> {
  const { appuserKey, tenantKey, user } = authedContext(req);
  await DI.em.populate(user, ['currencyKey']);
  return { appuserKey, currencyCode: user.currencyKey.code, tenantKey };
}
