import type { Request } from 'express';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const allowance = vi.hoisted(() => ({ spendAiAllowance: vi.fn() }));
vi.mock('@service/ai/ai-allowance.service', () => allowance);
vi.mock('@app/database/di', () => ({ DI: { em: {} } }));

const { errorHandler } = await import('@middleware/error-handler');
const { requireAiAllowance } = await import('../ai-allowance');

function appFor(tenantKey: number | undefined) {
  const app = express();
  app.use((req: Request, _res, next) => {
    if (tenantKey !== undefined) req.tenant = { tenantKey } as Request['tenant'];
    next();
  });
  app.post('/ocr', requireAiAllowance('ocr'), (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('requireAiAllowance', () => {
  beforeEach(() => allowance.spendAiAllowance.mockReset());

  it('lets the call through while the household has allowance left, charging that household', async () => {
    allowance.spendAiAllowance.mockResolvedValue(true);
    const res = await request(appFor(7)).post('/ocr');
    expect(res.status).toBe(200);
    expect(allowance.spendAiAllowance.mock.calls[0]?.slice(1)).toEqual([7, 'ocr']);
  });

  it('refuses the call once the allowance is used up, with a code the apps can act on', async () => {
    allowance.spendAiAllowance.mockResolvedValue(false);
    const res = await request(appFor(7)).post('/ocr');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ai_allowance_exhausted');
  });

  it('refuses a request with no household rather than letting it through uncounted', async () => {
    const res = await request(appFor(undefined)).post('/ocr');
    expect(res.status).toBe(403);
    expect(allowance.spendAiAllowance).not.toHaveBeenCalled();
  });
});
