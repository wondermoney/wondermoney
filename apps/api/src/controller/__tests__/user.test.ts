import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountFinancialInstitution } from '@entity/AccountFinancialInstitution';
import { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { NordigenRequisition } from '@entity/NordigenRequisition';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  findOne: vi.fn(),
  flush: vi.fn(),
  getRepository: vi.fn(),
  getUserById: vi.fn(),
  persist: vi.fn(),
}));

vi.mock('@app/app', () => ({
  DI: {
    em: {
      find: mocks.find,
      findOne: mocks.findOne,
      getRepository: mocks.getRepository,
      persist: mocks.persist,
    },
  },
}));

vi.mock('../../services/email/email', () => {
  throw new Error('email service should not load while importing user controller');
});

describe('user controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No AI provider configured, so the profile's effective capabilities are all off.
    for (const key of ['AI_BASE_URL', 'AI_MODEL', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_API_VERSION', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_OCR_DEPLOYMENT', 'AZURE_AI_FOUNDRY_API_KEY', 'AZURE_AI_FOUNDRY_API_VERSION', 'AZURE_AI_FOUNDRY_ENDPOINT']) vi.stubEnv(key, '');
    mocks.flush.mockResolvedValue(undefined);
    mocks.persist.mockReturnValue({ flush: mocks.flush });
    mocks.getRepository.mockReturnValue({ getUserById: mocks.getUserById });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('returns the authenticated user profile with the mobile MFA field', async () => {
    const { getCurrentUserProfile } = await import('../user');
    const json = vi.fn();
    const user = {
      appuserKey: 1,
      emailAddress: 'person@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      preferences: {},
    };

    await getCurrentUserProfile({ user } as unknown as Request, { json } as unknown as Response);

    expect(json).toHaveBeenCalledWith({
      profile: {
        ai: { assistant: false, csvMapping: false, enrichment: false, monthlyStory: false, ocr: false, statementImport: false },
        aiProviders: { statementImport: null },
        bankSyncCredentials: 'user',
        demo: false,
        emailAddress: 'person@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        mfaEnabled: false,
      },
    });
  });

  it('tells the shared demo account apart, so clients show the demo banner', async () => {
    const { getCurrentUserProfile } = await import('../user');
    const json = vi.fn();
    const user = { accountType: 'demo', appuserKey: 1, emailAddress: 'demo@wonder.money', firstName: 'Sofia', lastName: 'Martins', preferences: {} };

    await getCurrentUserProfile({ user } as unknown as Request, { json } as unknown as Response);

    expect(json).toHaveBeenCalledWith({ profile: expect.objectContaining({ demo: true }) });
  });

  it('reports every AI feature off once the person hid AI', async () => {
    vi.stubEnv('AI_BASE_URL', 'http://localhost:11434/v1');
    vi.stubEnv('AI_MODEL', 'llama3.1');
    const { getCurrentUserProfile } = await import('../user');
    const json = vi.fn();
    const user = {
      appuserKey: 1,
      emailAddress: 'person@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      preferences: { aiHidden: true },
    };

    await getCurrentUserProfile({ user } as unknown as Request, { json } as unknown as Response);

    expect(json).toHaveBeenCalledWith({
      profile: expect.objectContaining({
        ai: { assistant: false, csvMapping: false, enrichment: false, monthlyStory: false, ocr: false, statementImport: false },
      }),
    });
  });

  it('reports the instance capabilities when AI is not hidden', async () => {
    vi.stubEnv('AI_BASE_URL', 'http://localhost:11434/v1');
    vi.stubEnv('AI_MODEL', 'llama3.1');
    const { getCurrentUserProfile } = await import('../user');
    const json = vi.fn();
    const user = { appuserKey: 1, emailAddress: 'person@example.com', firstName: 'Ada', lastName: 'Lovelace', preferences: {} };

    await getCurrentUserProfile({ user } as unknown as Request, { json } as unknown as Response);

    expect(json).toHaveBeenCalledWith({
      profile: expect.objectContaining({
        ai: { assistant: true, csvMapping: true, enrichment: true, monthlyStory: true, ocr: true, statementImport: false },
      }),
    });
  });

  it('names who PDF statement pages go to, by family alone for an OpenAI-compatible endpoint, and nothing once AI is hidden', async () => {
    vi.stubEnv('AI_BASE_URL', 'http://ollama.lan.internal:11434/v1');
    vi.stubEnv('AI_MODEL_STATEMENT_IMPORT', 'qwen2.5vl');
    const { getCurrentUserProfile } = await import('../user');
    const profileOf = (preferences: Record<string, unknown>) => {
      const json = vi.fn();
      void getCurrentUserProfile({ user: { appuserKey: 1, emailAddress: 'person@example.com', firstName: 'Ada', lastName: 'Lovelace', preferences } } as unknown as Request, { json } as unknown as Response);
      return (json.mock.calls[0]?.[0] as { profile: { aiProviders: unknown } }).profile;
    };
    expect(profileOf({}).aiProviders).toEqual({ statementImport: { kind: 'openai-compatible', name: null } });
    expect(JSON.stringify(profileOf({}))).not.toContain('ollama.lan.internal');
    expect(profileOf({ aiHidden: true }).aiProviders).toEqual({ statementImport: null });

    vi.stubEnv('AI_BASE_URL', '');
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    vi.stubEnv('AI_MODEL', 'claude-sonnet-4-5');
    expect(profileOf({}).aiProviders).toEqual({ statementImport: { kind: 'anthropic', name: 'Anthropic' } });
  });

  it('reports mfaEnabled from req.authUser when two-factor is enabled', async () => {
    const { getCurrentUserProfile } = await import('../user');
    const json = vi.fn();
    const req = {
      authUser: { session: { id: 'session-1' }, user: { twoFactorEnabled: true } },
      user: {
        appuserKey: 1,
        emailAddress: 'person@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
    } as unknown as Request;

    await getCurrentUserProfile(req, { json } as unknown as Response);

    expect(json).toHaveBeenCalledWith({
      profile: {
        ai: { assistant: false, csvMapping: false, enrichment: false, monthlyStory: false, ocr: false, statementImport: false },
        aiProviders: { statementImport: null },
        bankSyncCredentials: 'user',
        demo: false,
        emailAddress: 'person@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        mfaEnabled: true,
      },
    });
  });

  describe('updateData', () => {
    const storedUser = () => ({ appuserKey: 1, emailAddress: 'owner@wonder.money', firstName: 'Ada', lastName: 'Lovelace' });

    const runUpdate = async (body: Record<string, unknown>, user = storedUser()) => {
      mocks.getUserById.mockResolvedValue(user);
      const { updateData } = await import('../user');
      const sendStatus = vi.fn();
      const next = vi.fn();
      const req = { body, params: { userId: '1' }, query: {}, user: { appuserKey: 1 } } as unknown as Request;

      await updateData(req, { sendStatus } as unknown as Response, next).catch((error: unknown) => {
        next(error);
      });

      return { next, sendStatus, user };
    };

    it('never writes a caller-supplied email onto the account', async () => {
      const { sendStatus, user } = await runUpdate({ emailAddress: 'victim@example.com', firstName: 'Ada' });

      expect(user.emailAddress).toBe('owner@wonder.money');
      expect(sendStatus).toHaveBeenCalledWith(200);
    });

    it('still applies the profile fields the user owns', async () => {
      const { sendStatus, user } = await runUpdate({ firstName: 'Grace', lastName: 'Hopper' });

      expect(user.firstName).toBe('Grace');
      expect(user.lastName).toBe('Hopper');
      expect(mocks.flush).toHaveBeenCalled();
      expect(sendStatus).toHaveBeenCalledWith(200);
    });

    it('rejects a name carrying markup', async () => {
      const { next, sendStatus } = await runUpdate({ firstName: '<b>Ada</b>' });

      expect(sendStatus).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
    });

    it('answers a unique-constraint collision with 409 instead of a 500 oracle', async () => {
      mocks.getUserById.mockResolvedValue(storedUser());
      mocks.flush.mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('duplicate key')));
      const { updateData } = await import('../user');
      const sendStatus = vi.fn();
      const next = vi.fn();

      await updateData(
        { body: { firstName: 'Grace' }, params: {}, query: {}, user: { appuserKey: 1 } } as unknown as Request,
        { sendStatus } as unknown as Response,
        next,
      );

      expect(sendStatus).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 409 }));
    });
  });

  describe('getRequisition', () => {
    it('validates the requisition id instead of passing req.params through raw', async () => {
      const { getRequisition } = await import('../user');
      const json = vi.fn();
      const req = { params: { requisitionId: 'not a valid id!' }, query: {}, user: { appuserKey: 1 } } as unknown as Request;

      await expect(getRequisition(req, { json } as unknown as Response)).rejects.toMatchObject({ status: 400 });
      expect(mocks.findOne).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
    });

    it('scopes the lookup to the authenticated user, not the :userId path param', async () => {
      mocks.findOne.mockResolvedValue({ requisitionId: 'req-1' });
      const { getRequisition } = await import('../user');
      const json = vi.fn();
      const req = {
        params: { requisitionId: 'req-1', userId: '999' },
        query: {},
        user: { appuserKey: 1 },
      } as unknown as Request;

      await getRequisition(req, { json } as unknown as Response);

      expect(mocks.findOne).toHaveBeenCalledWith(
        NordigenRequisition,
        { appuserKey: { appuserKey: 1 }, requisitionId: 'req-1' },
        expect.anything(),
      );
    });
  });

  describe('getRequisitions', () => {
    const buildReq = () => ({ user: { appuserKey: 1 } }) as unknown as Request;

    const mockFind = (input: {
      accountFinancialInstitutions?: unknown[];
      enableBankingConnections?: unknown[];
      nordigenRequisitions?: unknown[];
    }) => {
      mocks.find.mockImplementation((entity: unknown) => {
        if (entity === NordigenRequisition) return Promise.resolve(input.nordigenRequisitions ?? []);
        if (entity === EnableBankingConnection) return Promise.resolve(input.enableBankingConnections ?? []);
        if (entity === AccountFinancialInstitution) return Promise.resolve(input.accountFinancialInstitutions ?? []);
        return Promise.resolve([]);
      });
    };

    it('returns GoCardless requisitions unchanged when the user has no Enable Banking connections', async () => {
      const requisition = {
        accounts: [],
        appuserKey: 1,
        expiresAt: new Date('2026-01-01T00:00:00.000Z'),
        internalReference: 'ref-1',
        nordigenRequisitionKey: 1,
        requisitionId: 'req-1',
        status: 'linked',
      };
      mockFind({ nordigenRequisitions: [requisition] });
      const { getRequisitions } = await import('../user');
      const json = vi.fn();

      await getRequisitions(buildReq(), { json } as unknown as Response);

      // Pure spread + `provider: 'GoCardless'` — the legacy items keep their exact shape/values.
      expect(json).toHaveBeenCalledWith({ requisitions: [{ ...requisition, provider: 'GoCardless' }] });
      // Only the AccountFinancialInstitution lookup is skipped when there are no
      // Enable Banking connections to resolve institution info for.
      expect(mocks.find).toHaveBeenCalledTimes(2);
    });

    it('includes an Enable Banking connection with its accessValidUntil mapped onto the shared expiresAt field', async () => {
      const accessValidUntil = new Date('2026-12-01T00:00:00.000Z');
      const connection = {
        accessValidUntil,
        accounts: [],
        appuserKey: 1,
        aspspCountry: 'PT',
        aspspName: 'Test Bank',
        enableBankingConnectionKey: 5,
        status: 'linked',
      };
      mockFind({
        accountFinancialInstitutions: [{ id: 'enable_banking:pt:test-bank', logoUrl: 'https://logo.example/test-bank.png' }],
        enableBankingConnections: [connection],
      });
      const { getRequisitions } = await import('../user');
      const json = vi.fn();

      await getRequisitions(buildReq(), { json } as unknown as Response);

      expect(json).toHaveBeenCalledWith({
        requisitions: [
          {
            ...connection,
            consentStatus: expect.any(String),
            daysUntilExpiry: expect.any(Number),
            expiresAt: accessValidUntil,
            institution: { country: 'PT', logoUrl: 'https://logo.example/test-bank.png', name: 'Test Bank' },
            provider: 'EnableBanking',
          },
        ],
      });
    });

    it('tells the web which Enable Banking consents are expiring and which the bank ended early', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
      try {
        const base = { accounts: [], appuserKey: 1, aspspCountry: 'PT', aspspName: 'Test Bank' };
        mockFind({
          accountFinancialInstitutions: [],
          enableBankingConnections: [
            { ...base, accessValidUntil: new Date('2026-08-05T12:00:00.000Z'), enableBankingConnectionKey: 7, status: 'linked' },
            { ...base, accessValidUntil: new Date('2026-12-01T12:00:00.000Z'), enableBankingConnectionKey: 8, status: 'expired' },
            { ...base, accessValidUntil: new Date('2026-12-01T12:00:00.000Z'), enableBankingConnectionKey: 9, status: 'linked' },
          ],
        });
        const { getRequisitions } = await import('../user');
        const json = vi.fn();

        await getRequisitions(buildReq(), { json } as unknown as Response);

        expect(json).toHaveBeenCalledWith({
          requisitions: [
            expect.objectContaining({ consentStatus: 'expiring', daysUntilExpiry: 5, enableBankingConnectionKey: 7 }),
            expect.objectContaining({ consentStatus: 'revoked', daysUntilExpiry: 0, enableBankingConnectionKey: 8 }),
            expect.objectContaining({ consentStatus: 'active', daysUntilExpiry: 123, enableBankingConnectionKey: 9 }),
          ],
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('falls back to a null logo when no matching AccountFinancialInstitution row exists', async () => {
      const connection = {
        accessValidUntil: new Date('2026-12-01T00:00:00.000Z'),
        accounts: [],
        appuserKey: 1,
        aspspCountry: 'PT',
        aspspName: 'Unseen Bank',
        enableBankingConnectionKey: 6,
        status: 'linked',
      };
      mockFind({ accountFinancialInstitutions: [], enableBankingConnections: [connection] });
      const { getRequisitions } = await import('../user');
      const json = vi.fn();

      await getRequisitions(buildReq(), { json } as unknown as Response);

      expect(json).toHaveBeenCalledWith({
        requisitions: [
          expect.objectContaining({
            institution: { country: 'PT', logoUrl: null, name: 'Unseen Bank' },
            provider: 'EnableBanking',
          }),
        ],
      });
    });

    it('returns both provider types together when a user has GoCardless and Enable Banking connections', async () => {
      const requisition = {
        accounts: [],
        appuserKey: 1,
        expiresAt: new Date('2026-01-01T00:00:00.000Z'),
        internalReference: 'ref-1',
        nordigenRequisitionKey: 1,
        requisitionId: 'req-1',
        status: 'linked',
      };
      const connection = {
        accessValidUntil: new Date('2026-12-01T00:00:00.000Z'),
        accounts: [],
        appuserKey: 1,
        aspspCountry: 'ES',
        aspspName: 'Another Bank',
        enableBankingConnectionKey: 7,
        status: 'linked',
      };
      mockFind({ enableBankingConnections: [connection], nordigenRequisitions: [requisition] });
      const { getRequisitions } = await import('../user');
      const json = vi.fn();

      await getRequisitions(buildReq(), { json } as unknown as Response);

      expect(json).toHaveBeenCalledWith({
        requisitions: [
          { ...requisition, provider: 'GoCardless' },
          expect.objectContaining({ enableBankingConnectionKey: 7, provider: 'EnableBanking' }),
        ],
      });
    });

    it('excludes soft-deleted Enable Banking connections by querying with deletedAt: undefined', async () => {
      mockFind({ enableBankingConnections: [], nordigenRequisitions: [] });
      const { getRequisitions } = await import('../user');
      const json = vi.fn();

      await getRequisitions(buildReq(), { json } as unknown as Response);

      expect(mocks.find).toHaveBeenCalledWith(
        EnableBankingConnection,
        expect.objectContaining({ deletedAt: undefined }),
        expect.anything(),
      );
      expect(json).toHaveBeenCalledWith({ requisitions: [] });
    });
  });
});
