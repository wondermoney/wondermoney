import { RequestContext } from '@mikro-orm/postgresql';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addAccount, addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { ApiToken } from '@entity/ApiToken';
import { AssistantAuditLog, AssistantAuditSource } from '@entity/AssistantAuditLog';
import { errorHandler } from '@middleware/error-handler';
import mcpRoutes from '@route/mcp';
import { createApiToken, hashApiToken } from '@service/api-token/api-token.service';
import { resetMcpToolCallWindows } from '@service/mcp/mcp-rate-limit.service';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

const db = useTestDatabase();

function mcpApp() {
  const app = express();
  app.use((_req, _res, next) => {
    RequestContext.create(db.orm.em, next);
  });
  app.use(express.json());
  app.use('/v1/mcp', mcpRoutes);
  app.use(errorHandler);
  return request(app);
}

const initialize = {
  id: 1,
  jsonrpc: '2.0',
  method: 'initialize',
  params: { capabilities: {}, clientInfo: { name: 'test-client', version: '1.0.0' }, protocolVersion: '2025-11-25' },
};

describe('POST /v1/mcp', () => {
  beforeEach(() => {
    DI.em = db.em();
    resetMcpToolCallWindows();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function seedToken(scopes: ('mcp:read' | 'read' | 'write')[] = ['mcp:read']) {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const { apiToken, token } = await createApiToken(
      { appuser: household.appuser, expiresInDays: 30, name: 'AI client', scopes, tenant: household.tenant },
      em,
    );
    return { apiToken, household, partner, token };
  }

  const post = (token: null | string, body: unknown) => {
    const agent = mcpApp().post('/v1/mcp').set('Accept', 'application/json, text/event-stream').set('Content-Type', 'application/json');
    return token === null ? agent.send(body as object) : agent.set('Authorization', `Bearer ${token}`).send(body as object);
  };

  it('answers initialize with the server identity and tool capability', async () => {
    const { token } = await seedToken();

    const response = await post(token, initialize);

    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({
      capabilities: { tools: expect.any(Object) },
      serverInfo: { name: 'wondermoney' },
    });
    expect(response.body.result.protocolVersion).toEqual(expect.any(String));
  });

  it('lists every read-only tool, including the new search and list tools', async () => {
    const { token } = await seedToken();

    const response = await post(token, { id: 2, jsonrpc: '2.0', method: 'tools/list' });

    expect(response.status).toBe(200);
    const names = (response.body.result.tools as { name: string }[]).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      'compare_budget_periods',
      'get_account_balance_summary',
      'get_budget_status',
      'get_cashflow_summary',
      'get_goal_progress_summary',
      'get_insights',
      'get_large_transactions_summary',
      'get_net_worth_summary',
      'get_portfolio_income_summary',
      'get_portfolio_summary',
      'get_recurring_payments_summary',
      'get_spending_by_category',
      'get_spending_trend',
      'list_accounts',
      'list_budgets',
      'list_categories',
      'search_transactions',
    ]));
    expect(names).toHaveLength(17);
  });

  it('calls a tool and returns its real data', async () => {
    const { household, token } = await seedToken();
    await addAccount(db.em(), household, { appuserCurrencyBalance: 321, name: 'MCP account' });

    const response = await post(token, {
      id: 3,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: {}, name: 'list_accounts' },
    });

    expect(response.status).toBe(200);
    expect(response.body.result.isError).toBeUndefined();
    const data = JSON.parse(response.body.result.content[0].text) as { accounts: { name: string }[] };
    expect(data.accounts.map((account) => account.name)).toContain('MCP account');
  });

  it('never returns another household\'s data or a partner\'s private account', async () => {
    const em = db.em();
    const { household, partner, token } = await seedToken();
    await addAccount(em, household, { appuserCurrencyBalance: 900, isPrivate: true, name: 'Partner private', owner: partner });
    const other = await seedHousehold(em);
    await addAccount(em, other, { appuserCurrencyBalance: 700, name: 'Other household' });

    const response = await post(token, {
      id: 4,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: {}, name: 'list_accounts' },
    });

    const data = JSON.parse(response.body.result.content[0].text) as { accounts: { name: string }[] };
    const names = data.accounts.map((account) => account.name);
    expect(names).not.toContain('Partner private');
    expect(names).not.toContain('Other household');
  });

  it('rejects a revoked token with 401', async () => {
    const { apiToken, token } = await seedToken();
    const em = db.em();
    const row = await em.findOne(ApiToken, { apiTokenKey: apiToken.apiTokenKey });
    if (!row) throw new Error('token row missing');
    row.revokedAt = new Date();
    await em.flush();

    const response = await post(token, initialize);

    expect(response.status).toBe(401);
  });

  it('rejects an expired token with 401', async () => {
    const { token } = await seedToken();
    await db.em().nativeUpdate(ApiToken, { secretHash: hashApiToken(token) }, { expiresAt: new Date(Date.now() - 1_000) });

    const response = await post(token, initialize);

    expect(response.status).toBe(401);
  });

  it('rejects a token without mcp:read with 403', async () => {
    const { token } = await seedToken(['read', 'write']);

    const response = await post(token, initialize);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('api_token_scope_required');
  });

  it('rejects a session cookie on this route', async () => {
    const response = await mcpApp()
      .post('/v1/mcp')
      .set('Cookie', 'better-auth.session_token=a-real-looking-session')
      .set('Content-Type', 'application/json')
      .send(initialize);

    expect(response.status).toBe(401);
  });

  it('answers 404 when MCP_ENABLED is false', async () => {
    const { token } = await seedToken();
    vi.stubEnv('MCP_ENABLED', 'false');

    const response = await post(token, initialize);

    expect(response.status).toBe(404);
  });

  it('writes an audit entry without financial values', async () => {
    const { household, token } = await seedToken();
    const account = await addAccount(db.em(), household, { appuserCurrencyBalance: 1234.56, name: 'Audited account' });

    await post(token, {
      id: 5,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: {}, name: 'list_accounts' },
    });

    const entries = await db.em().find(AssistantAuditLog, {});
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    if (!entry) throw new Error('audit entry missing');
    expect(entry).toMatchObject({ source: AssistantAuditSource.MCP, toolName: 'list_accounts' });
    expect(entry.apiTokenKey?.apiTokenKey).toEqual(expect.any(Number));
    const serialised = JSON.stringify(entry.metadata ?? {});
    expect(serialised).not.toContain('1234.56');
    expect(serialised).not.toContain(account.accountName);
  });

  it('caps tool calls per token per minute', async () => {
    const { token } = await seedToken();
    vi.stubEnv('MCP_TOOL_CALLS_PER_MINUTE', '2');
    const call = () => post(token, {
      id: 6,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: {}, name: 'list_accounts' },
    });

    expect((await call()).body.result.isError).toBeUndefined();
    expect((await call()).body.result.isError).toBeUndefined();
    const third = await call();
    expect(third.body.result.isError).toBe(true);
    expect(JSON.stringify(third.body.result)).toMatch(/too many tool calls/i);
  });
});
