import express from 'express';

import { getOpenAiAppsChallenge } from '@controller/openai-apps-challenge';

/**
 * OpenAI's domain-verification file for the ChatGPT plugin, mounted at `/.well-known` (the API's
 * root, where OpenAI looks on the MCP server's hostname). Public: OpenAI fetches it without a
 * credential. 404 unless `OPENAI_APPS_CHALLENGE` is set.
 */
const router = express.Router();

router.get('/openai-apps-challenge', getOpenAiAppsChallenge);

export default router;
