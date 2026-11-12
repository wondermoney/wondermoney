import express from 'express';

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
router.get('/:manualAssetId/valuations', listManualAssetValuations);
router.post('/:manualAssetId/valuations', createManualAssetValuation);
router.patch('/:manualAssetId/valuations/:valuationId', updateManualAssetValuation);
router.delete('/:manualAssetId/valuations/:valuationId', deleteManualAssetValuation);
router.get('/:manualAssetId', getManualAsset);
router.patch('/:manualAssetId', updateManualAsset);
router.delete('/:manualAssetId', deleteManualAsset);

export default router;
