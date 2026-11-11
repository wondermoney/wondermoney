import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
vi.mock('@service/assistant/assistant.service', () => ({ AssistantService: { streamChat: vi.fn() } }));

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Appuser } from '@entity/Appuser';
import accountRoutes from '@route/account';
import assistantRoutes from '@route/assistant';
import portfolioImportSessionRoutes from '@route/portfolio-import-session';

/*
 * Hiding AI is enforced by the API, not only by the apps: each endpoint that would call a model
 * refuses with 403 `feature_disabled` for that person. The instance still has the provider, so a
 * pass-through would reach the controller — which is what makes the 403 meaningful.
 */
describe('AI endpoints for a person who hid AI', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const assistant = tenantHttp('/v1/assistant', assistantRoutes);
  const account = tenantHttp('/v1/account', accountRoutes);
  const portfolioImport = tenantHttp('/v1/portfolio-import-sessions', portfolioImportSessionRoutes);

  afterEach(() => vi.unstubAllEnvs());

  async function seed(aiHidden: boolean) {
    vi.stubEnv('AI_BASE_URL', 'http://localhost:11434/v1');
    vi.stubEnv('AI_MODEL', 'llama3.1');
    const household = await seedHousehold(db.em());
    await db.em().nativeUpdate(Appuser, { appuserKey: household.appuser.appuserKey }, { preferences: { aiHidden } });
    return household;
  }

  it('refuses the assistant chat', async () => {
    const household = await seed(true);

    const response = await assistant.as(household.appuser).post('/v1/assistant/chat').send({ messages: [] });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('feature_disabled');
  });

  it('refuses receipt scanning', async () => {
    const household = await seed(true);

    const response = await account.as(household.appuser).post('/v1/account/transaction/ocr');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('feature_disabled');
  });

  it('refuses the AI column-mapping suggestion', async () => {
    const household = await seed(true);

    const response = await portfolioImport
      .as(household.appuser)
      .post('/v1/portfolio-import-sessions/1/column-mapping/suggest');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('feature_disabled');
  });

  it('lets the assistant through again once the switch is off', async () => {
    const household = await seed(false);

    const response = await assistant
      .as(household.appuser)
      .post('/v1/assistant/chat')
      .send({ messages: [{ content: 'Hello', role: 'user' }] });

    // The gate passed; the controller's own consent check answers, not the AI-hidden refusal.
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('assistant_not_enabled');
  });

  it('refuses an unauthenticated caller before any AI check', async () => {
    await seed(true);

    const response = await request(assistant.app).post('/v1/assistant/chat').send({ messages: [] });

    expect(response.status).toBe(401);
  });
});
