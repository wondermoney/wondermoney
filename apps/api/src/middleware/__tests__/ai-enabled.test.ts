import type { Request } from 'express';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { errorHandler } = await import('@middleware/error-handler');
const { requireAiAllowed } = await import('../ai-enabled');

function appFor(preferences: Record<string, unknown> | undefined) {
  const app = express();
  app.use((req: Request, _res, next) => {
    if (preferences !== undefined) req.user = { appuserKey: 1, preferences } as Request['user'];
    next();
  });
  app.post('/ai', requireAiAllowed('assistant'), (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('requireAiAllowed', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('lets the call through when the instance has the feature and the person kept AI on', async () => {
    vi.stubEnv('AI_BASE_URL', 'http://localhost:11434/v1');
    vi.stubEnv('AI_MODEL', 'llama3.1');

    const res = await request(appFor({ aiHidden: false })).post('/ai');

    expect(res.status).toBe(200);
  });

  it('refuses a person who hid AI with 403 feature_disabled', async () => {
    vi.stubEnv('AI_BASE_URL', 'http://localhost:11434/v1');
    vi.stubEnv('AI_MODEL', 'llama3.1');

    const res = await request(appFor({ aiHidden: true })).post('/ai');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('feature_disabled');
  });

  it('keeps the 501 for a server with no provider, which the person cannot change', async () => {
    vi.stubEnv('AI_BASE_URL', '');
    vi.stubEnv('AI_MODEL', '');

    const res = await request(appFor({ aiHidden: false })).post('/ai');

    expect(res.status).toBe(501);
    expect(res.body.code).toBe('feature_disabled');
  });
});
