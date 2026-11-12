import express from 'express';

import { confirmPortfolioImportSession, confirmPortfolioImportSessionAssetMappings, confirmPortfolioImportSessionColumnMapping, getPortfolioImportSessionPreview, suggestPortfolioImportSessionColumnMapping, triggerPortfolioImportSessionParse, updatePortfolioImportSessionRowInclusion } from '@controller/portfolio-import-session';
import { requireAiAllowed } from '@middleware/ai-enabled';

const router = express.Router();

router.post('/:importSessionId/column-mapping/suggest', requireAiAllowed('csvMapping'), suggestPortfolioImportSessionColumnMapping);
router.patch('/:importSessionId/column-mapping', confirmPortfolioImportSessionColumnMapping);
router.patch('/:importSessionId/asset-mappings', confirmPortfolioImportSessionAssetMappings);
router.patch('/:importSessionId/row-inclusions', updatePortfolioImportSessionRowInclusion);
router.post('/:importSessionId/confirm', confirmPortfolioImportSession);
router.post('/:importSessionId/parse', triggerPortfolioImportSessionParse);
router.get('/:importSessionId', getPortfolioImportSessionPreview);

export default router;
