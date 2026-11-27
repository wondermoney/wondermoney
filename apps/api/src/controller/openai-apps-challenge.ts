import type { Request, Response } from 'express';

import { openAiAppsChallenge } from '@config/openai-apps';
import { NotFoundError } from '@utils/errors';

/**
 * `GET /.well-known/openai-apps-challenge` — OpenAI's domain verification for a ChatGPT plugin
 * whose MCP server is this API: the exact token, as plain text and nothing else. Read on every
 * request and never cached, so a replaced token is served at once. 404 while
 * `OPENAI_APPS_CHALLENGE` is unset.
 */
export function getOpenAiAppsChallenge(_req: Request, res: Response) {
  const token = openAiAppsChallenge();
  if (!token) throw new NotFoundError();
  res.setHeader('Cache-Control', 'no-store');
  return res.type('text/plain').send(token);
}
