import type { Request } from 'express';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { errorHandler } from '@middleware/error-handler';

import { requireVerifiedEmailForAi } from '../email-verification';

function appFor(emailVerified: boolean | undefined) {
  const app = express();
  app.use((req: Request, _res, next) => {
    if (emailVerified !== undefined) {
      req.authUser = { session: { createdAt: new Date(), id: 's' }, user: { email: 'a@example.test', emailVerified, id: 'u' } };
    }
    next();
  });
  app.post('/ai', requireVerifiedEmailForAi, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('requireVerifiedEmailForAi', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lets an unverified account through when the server does not require verification', async () => {
    const res = await request(appFor(false)).post('/ai');
    expect(res.status).toBe(200);
  });

  describe('when the server requires a verified email', () => {
    it('lets a verified account through', async () => {
      vi.stubEnv('AI_REQUIRES_VERIFIED_EMAIL', 'true');
      const res = await request(appFor(true)).post('/ai');
      expect(res.status).toBe(200);
    });

    it('refuses an unverified account with a code the apps can act on', async () => {
      vi.stubEnv('AI_REQUIRES_VERIFIED_EMAIL', 'true');
      const res = await request(appFor(false)).post('/ai');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('email_verification_required');
    });

    it('refuses a request with no authenticated user', async () => {
      vi.stubEnv('AI_REQUIRES_VERIFIED_EMAIL', 'true');
      const res = await request(appFor(undefined)).post('/ai');
      expect(res.status).toBe(403);
    });
  });
});
