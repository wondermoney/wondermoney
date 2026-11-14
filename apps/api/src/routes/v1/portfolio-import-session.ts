import express from 'express';

import { confirmPortfolioImportSession, confirmPortfolioImportSessionAssetMappings, confirmPortfolioImportSessionColumnMapping, getPortfolioImportSessionPreview, suggestPortfolioImportSessionColumnMapping, triggerPortfolioImportSessionParse, updatePortfolioImportSessionRowInclusion } from '@controller/portfolio-import-session';

const router = express.Router();

// Not behind `requireAiAllowed`: a saved spec or the column names answer without a model, and the
// controller only lets the service ask one when this person may use AI column mapping.
router.post('/:importSessionId/column-mapping/suggest', suggestPortfolioImportSessionColumnMapping);
router.patch('/:importSessionId/column-mapping', confirmPortfolioImportSessionColumnMapping);
router.patch('/:importSessionId/asset-mappings', confirmPortfolioImportSessionAssetMappings);
router.patch('/:importSessionId/row-inclusions', updatePortfolioImportSessionRowInclusion);
router.post('/:importSessionId/confirm', confirmPortfolioImportSession);
router.post('/:importSessionId/parse', triggerPortfolioImportSessionParse);
router.get('/:importSessionId', getPortfolioImportSessionPreview);

export default router;
