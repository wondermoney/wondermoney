import express from 'express';

import {
  addWalletAddress,
  createCryptoWallet,
  removeWalletAddress,
  syncCryptoWallet,
  updateWalletAddress,
  updateWalletToken,
} from '@controller/crypto-wallet';
import {
  createManualAsset,
  createManualAssetValuation,
  deleteManualAsset,
  deleteManualAssetValuation,
  getManualAsset,
  importManualAssets,
  listManualAssets,
  listManualAssetValuations,
  updateManualAsset,
  updateManualAssetValuation,
} from '@controller/manual-asset';

const router = express.Router();

router.get('/', listManualAssets);
router.post('/', createManualAsset);
router.post('/import', importManualAssets);
// Crypto wallets: manual assets valued from public addresses (`controller/crypto-wallet.ts`).
router.post('/crypto-wallets', createCryptoWallet);
router.post('/:manualAssetId/addresses', addWalletAddress);
router.patch('/:manualAssetId/addresses/:addressId', updateWalletAddress);
router.delete('/:manualAssetId/addresses/:addressId', removeWalletAddress);
router.patch('/:manualAssetId/tokens/:tokenId', updateWalletToken);
router.post('/:manualAssetId/sync', syncCryptoWallet);
router.get('/:manualAssetId/valuations', listManualAssetValuations);
router.post('/:manualAssetId/valuations', createManualAssetValuation);
router.patch('/:manualAssetId/valuations/:valuationId', updateManualAssetValuation);
router.delete('/:manualAssetId/valuations/:valuationId', deleteManualAssetValuation);
router.get('/:manualAssetId', getManualAsset);
router.patch('/:manualAssetId', updateManualAsset);
router.delete('/:manualAssetId', deleteManualAsset);

export default router;
