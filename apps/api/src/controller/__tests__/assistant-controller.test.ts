import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  find: vi.fn(),
  findOne: vi.fn(),
  flush: vi.fn(),
  persist: vi.fn().mockReturnThis(),
  populate: vi.fn(),
  streamChat: vi.fn(),
}));

vi.mock('@validators/parser', () => ({
  zParse: vi.fn((schema: { parseAsync: (req: unknown) => Promise<unknown> }, req: unknown) => schema.parseAsync(req)),
}));

vi.mock('@app/app', () => ({
  DI: {
    em: {
      find: mocked.find,
      findOne: mocked.findOne,
      flush: mocked.flush,
      persist: mocked.persist,
      populate: mocked.populate,
    },
  },
}));

vi.mock('@entity/AssistantConsent', () => ({
  AssistantChatRetentionMode: { TEMPORARY: 'temporary' },
  AssistantConsent: class AssistantConsent {
    assistantEnabled = false;
  },
}));

vi.mock('@entity/AssistantAuditLog', () => ({
  AssistantAuditLog: {},
}));

vi.mock('@entity/Appuser', () => ({
  Appuser: {},
  SupportedLanguages: { EN: 'EN', PT: 'PT' },
}));

vi.mock('@entity/Tenant', () => ({
  Tenant: {},
}));

vi.mock('@service/assistant/assistant.service', () => ({
  AssistantService: {
    streamChat: mocked.streamChat,
  },
}));

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { chatWithAssistant, disableAssistant, getAssistantAuditLog, getAssistantConsent, updateAssistantConsent } from '../assistant';

function response() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json, sendStatus: vi.fn() });
  const sendStatus = vi.fn();
  return { json, sendStatus, status };
}

describe('assistant controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns default disabled consent when no record exists', async () => {
    const user = { appuserKey: 7, emailAddress: 'someone@example.com' };
    const tenant = { tenantKey: 9 };
    mocked.findOne.mockResolvedValueOnce({ tenantKey: tenant }).mockResolvedValueOnce(null);

    const res = response();

    await getAssistantConsent(Object.assign(mockReq(), { authUser: { user: { email: 'someone@example.com' } }, user }), mockRes({ json: res.json }));

    expect(mocked.findOne).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ appuserKey: user, deletedAt: null, tenantKey: tenant }));
    expect(res.json).toHaveBeenCalledWith({
      consent: {
        assistantEnabled: false,
        chatRetentionMode: 'temporary',
        consentVersion: 1,
        disabledAt: null,
        enabledAt: null,
        launcherHidden: false,
        providerDisclosureVersion: 1,
      },
    });
  });

  it('enables assistant and persists a consent record using references', async () => {
    const user = { appuserKey: 7, emailAddress: 'someone@example.com' };
    const tenant = { tenantKey: 9 };
    mocked.findOne.mockResolvedValueOnce({ tenantKey: tenant }).mockResolvedValueOnce(null);
    mocked.flush.mockResolvedValueOnce(undefined);

    const res = response();

    await updateAssistantConsent(
      Object.assign(mockReq({ body: { assistantEnabled: true, launcherHidden: true } }), { authUser: { user: { email: 'someone@example.com' } }, user }),
      mockRes({ json: res.json }),
    );

    expect(mocked.persist).toHaveBeenCalledWith(expect.objectContaining({ appuserKey: user, assistantEnabled: true, launcherHidden: true, tenantKey: tenant }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ consent: expect.objectContaining({ assistantEnabled: true }) }));
  });

  it('disables assistant and creates a disabled consent record when missing', async () => {
    const user = { appuserKey: 7, emailAddress: 'someone@example.com' };
    const tenant = { tenantKey: 9 };
    mocked.findOne.mockResolvedValueOnce({ tenantKey: tenant }).mockResolvedValueOnce(null);
    mocked.flush.mockResolvedValueOnce(undefined);

    const res = response();

    await disableAssistant(Object.assign(mockReq(), { authUser: { user: { email: 'someone@example.com' } }, user }), mockRes({ json: res.json }));

    expect(mocked.persist).toHaveBeenCalledWith(expect.objectContaining({ appuserKey: user, assistantEnabled: false, tenantKey: tenant }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ consent: expect.objectContaining({ assistantEnabled: false }) }));
  });

  it('returns sanitized audit log events', async () => {
    const user = { appuserKey: 7, emailAddress: 'someone@example.com' };
    const tenant = { tenantKey: 9 };
    const createdAt = new Date('2026-05-31T12:00:00Z');
    mocked.findOne.mockResolvedValueOnce({ tenantKey: tenant });
    mocked.find.mockResolvedValueOnce([
      {
        appuserKey: user,
        assistantAuditLogKey: 123,
        conversationId: 'conversation-1',
        createdAt,
        eventType: 'tool_called',
        metadata: { dataCategory: 'transactions', rawPayload: 'hidden', recordCount: 3 },
        tenantKey: tenant,
        toolName: 'get_cashflow_summary',
        updatedAt: new Date(),
      },
    ]);

    const res = response();

    await getAssistantAuditLog(Object.assign(mockReq({ query: { limit: '10' } }), { authUser: { user: { email: 'someone@example.com' } }, user }), mockRes({ json: res.json }));

    expect(mocked.find).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ appuserKey: user, deletedAt: null, tenantKey: tenant }), expect.objectContaining({ limit: 10, orderBy: { createdAt: 'desc' } }));
    expect(res.json).toHaveBeenCalledWith({
      events: [
        {
          conversationId: 'conversation-1',
          createdAt,
          eventType: 'tool_called',
          metadata: { dataCategory: 'transactions', recordCount: 3 },
          toolName: 'get_cashflow_summary',
        },
      ],
    });
  });

  it('returns 403 for chat when assistant is disabled before streaming', async () => {
    const user = { appuserKey: 7, emailAddress: 'someone@example.com' };
    const tenant = { tenantKey: 9 };
    mocked.findOne.mockResolvedValueOnce({ tenantKey: tenant }).mockResolvedValueOnce({ assistantEnabled: false, consentVersion: 1 });

    const res = response();

    await chatWithAssistant(
      Object.assign(mockReq({ body: { messages: [{ parts: [{ text: 'Hello', type: 'text' }], role: 'user' }] } }), { authUser: { user: { email: 'someone@example.com' } }, user }),
      mockRes({ json: res.json, status: res.status }),
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ code: 'assistant_not_enabled', message: 'Assistant is not enabled for this account.' });
    expect(mocked.streamChat).not.toHaveBeenCalled();
  });

  it('streams chat when assistant is enabled', async () => {
    const user = { appuserKey: 7, currencyKey: { code: 'EUR' }, emailAddress: 'someone@example.com', language: 'EN' };
    const tenant = { tenantKey: 9 };
    const messages = [{ parts: [{ text: 'Hello', type: 'text' }], role: 'user' }];
    mocked.findOne.mockResolvedValueOnce({ tenantKey: tenant }).mockResolvedValueOnce({ assistantEnabled: true, consentVersion: 4 });
    mocked.streamChat.mockResolvedValueOnce(undefined);

    const res = response();

    await chatWithAssistant(
      Object.assign(mockReq({ body: { id: 'conversation-1', messages } }), { authUser: { user: { email: 'someone@example.com' } }, user }),
      mockRes({ json: res.json, status: res.status }),
    );

    expect(mocked.streamChat).toHaveBeenCalledWith(expect.objectContaining({
      appuserKey: 7,
      consent: { assistantEnabled: true, consentVersion: 4 },
      conversationId: expect.any(String),
      messages,
      tenantKey: 9,
    }));
  });

  it('formats the chat in the base currency and the locale the client is showing', async () => {
    const user = { appuserKey: 7, currencyKey: { code: 'EUR' }, emailAddress: 'someone@example.com', language: 'EN' };
    mocked.findOne.mockResolvedValueOnce({ tenantKey: { tenantKey: 9 } }).mockResolvedValueOnce({ assistantEnabled: true, consentVersion: 4 });

    await chatWithAssistant(
      Object.assign(mockReq({ body: { locale: 'pt', messages: [{ parts: [{ text: 'Olá', type: 'text' }], role: 'user' }] } }), { user }),
      mockRes(),
    );

    expect(mocked.streamChat).toHaveBeenCalledWith(expect.objectContaining({ currency: 'EUR', locale: 'pt' }));
  });

  it('falls back to the account language when the client sends no locale', async () => {
    const user = { appuserKey: 7, currencyKey: { code: 'EUR' }, emailAddress: 'someone@example.com', language: 'PT' };
    mocked.findOne.mockResolvedValueOnce({ tenantKey: { tenantKey: 9 } }).mockResolvedValueOnce({ assistantEnabled: true, consentVersion: 4 });

    await chatWithAssistant(
      Object.assign(mockReq({ body: { messages: [{ parts: [{ text: 'Olá', type: 'text' }], role: 'user' }] } }), { user }),
      mockRes(),
    );

    expect(mocked.streamChat).toHaveBeenCalledWith(expect.objectContaining({ currency: 'EUR', locale: 'pt' }));
  });

  // Any account reaches the assistant: the only thing that stops a chat is the
  // person's own consent record.
  it('serves the assistant to an account on any email domain', async () => {
    const user = { appuserKey: 7, emailAddress: 'someone@example.com' };
    const tenant = { tenantKey: 9 };
    mocked.findOne.mockResolvedValueOnce({ tenantKey: tenant }).mockResolvedValueOnce(null);

    const res = response();

    await getAssistantConsent(Object.assign(mockReq(), { supabaseUser: { email: 'someone@example.com' }, user }), mockRes({ json: res.json }));

    expect(res.json).toHaveBeenCalledWith({ consent: expect.objectContaining({ assistantEnabled: false, launcherHidden: false }) });
  });

  it('still refuses to chat when the account has not consented', async () => {
    const user = { appuserKey: 7, emailAddress: 'someone@example.com' };
    const tenant = { tenantKey: 9 };
    const messages = [{ parts: [{ text: 'Hello', type: 'text' }], role: 'user' }];
    mocked.findOne.mockResolvedValueOnce({ tenantKey: tenant }).mockResolvedValueOnce({ assistantEnabled: false });

    const res = response();

    await chatWithAssistant(
      Object.assign(mockReq({ body: { id: 'conversation-1', messages } }), { authUser: { user: { email: 'user@example.com' } }, user }),
      mockRes({ json: res.json, status: res.status }),
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mocked.streamChat).not.toHaveBeenCalled();
  });
});
