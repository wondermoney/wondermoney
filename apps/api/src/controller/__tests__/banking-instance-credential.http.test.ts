import { generateKeyPairSync } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['CREDENTIAL_ENCRYPTION_KEY_V1'] = Buffer.alloc(32, 9).toString('base64');
});
/** What reached the error tracker. */
const reported = vi.hoisted(() => ({ events: [] as unknown[] }));
vi.mock('@sentry/node', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sentry/node')>()),
  captureException: (...args: unknown[]) => { reported.events.push(args); return 'event'; },
}));
vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

/** Which Enable Banking application each provider call was signed as. */
const provider = vi.hoisted(() => ({ calls: [] as { applicationId: string; method: string; privateKeyPem: string }[] }));
vi.mock('@service/enable-banking/enable-banking-client.service', () => ({
  createEnableBankingClient: ({ applicationId, privateKeyPem }: { applicationId: string; privateKeyPem: string }) => {
    const record = (method: string) => provider.calls.push({ applicationId, method, privateKeyPem });
    return {
      exchangeSession: () => { record('exchangeSession'); return Promise.resolve({ access: { validUntil: '2027-06-01T00:00:00.000Z' }, accounts: [], sessionId: 'session-1' }); },
      getAccountBalances: () => { record('getAccountBalances'); return Promise.resolve({ balances: [] }); },
      getAccountTransactions: () => { record('getAccountTransactions'); return Promise.resolve({ transactions: [] }); },
      getSession: () => { record('getSession'); return Promise.resolve({ status: 'AUTHORIZED' }); },
      listInstitutions: () => { record('listInstitutions'); return Promise.resolve([{ country: 'PT', logo: '', maximum_consent_validity: 7_776_000, name: 'Banco Exemplo' }]); },
      startAuthorization: () => { record('startAuthorization'); return Promise.resolve({ authorizationId: 'auth-1', psuIdHash: 'hash', url: 'https://bank.example/consent' }); },
    };
  },
}));

/** The key file the operator mounted, read through the seam instead of the disk. */
const keyFiles = vi.hoisted(() => {
  const files: Record<string, string> = {};
  return { files };
});
vi.mock('@utils/read-secret-file', () => ({
  readSecretFile: (path: string) => {
    const content = keyFiles.files[path];
    if (content === undefined) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });
    return content;
  },
}));

import { addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { mockReq, mockRes } from '@app/__tests__/__helpers__/mock-request';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { getInstance } from '@controller/instance';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { BankConnection } from '@entity/BankConnection';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { Tenant, TenantType } from '@entity/Tenant';
import bankingRoutes from '@route/banking';
import userRoutes from '@route/user';
import { UserActionRequiredError } from '@service/bank-providers/errors';
import { bankConnectionRef, getBankProvider } from '@service/bank-providers/registry';
import { getRef } from '@utils/em-helpers';
import { encodeEnableBankingInstitutionId } from '@utils/enable-banking-institution-id';
import logger from '@utils/logger';

/*
 * The operator's own Enable Banking application, shared by the instance. Enable Banking's
 * Restricted Production mode only lets an application link its owner's accounts, so it serves one
 * household: the only one on the instance, or the first to link with it. A full production
 * contract (`ENABLE_BANKING_PRODUCTION_CONTRACT`) lifts that. A user's own credential always wins.
 */

const KEY_FILE = '/run/secrets/enable_banking_private_key';
const INSTANCE_APP_ID = 'instance-app';
const INSTANCE_PEM = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' });
const USER_PEM = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' });
/** Lines from the middle of each key: if one shows up in output, a key leaked. */
const KEY_LINES = [INSTANCE_PEM.split('\n')[5], INSTANCE_PEM.split('\n')[10], USER_PEM.split('\n')[5]].filter((line): line is string => Boolean(line));
const BANK_ID = encodeEnableBankingInstitutionId({ country: 'PT', name: 'Banco Exemplo' });

describe('instance-wide Enable Banking credentials', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const banking = tenantHttp('/v1/banking', bankingRoutes);
  const user = tenantHttp('/v1/user', userRoutes);

  const configureInstanceCredential = () => {
    keyFiles.files = { [KEY_FILE]: INSTANCE_PEM };
    vi.stubEnv('ENABLE_BANKING_APP_ID', INSTANCE_APP_ID);
    vi.stubEnv('ENABLE_BANKING_PRIVATE_KEY_FILE', KEY_FILE);
  };
  const signedAs = (method: string) => provider.calls.filter((call) => call.method === method).map((call) => call.applicationId);
  const listBanks = (who: Appuser) => banking.as(who).get('/v1/banking/bank?country=PT');
  const startLink = (who: Appuser) => banking.as(who).get(`/v1/banking/bank/${BANK_ID}/start`);
  const credentialsFor = async (who: Appuser) => ((await user.as(who).get('/v1/user/me/profile')).body as { profile: { bankSyncCredentials: string } }).profile.bankSyncCredentials;
  const saveOwnCredential = (who: Appuser) => user.as(who).post('/v1/user/enable-banking-credential').send({ applicationId: `own-app-${who.appuserKey}`, privateKeyPem: USER_PEM });
  /** The connection a start left behind, as the consent callback would mark it. */
  const linkedConnectionOf = async (who: Appuser) => {
    const em = db.em();
    const connection = await em.findOneOrFail(EnableBankingConnection, { appuserKey: who }, { orderBy: { createdAt: 'desc' }, populate: ['bankConnectionKey', 'enableBankingCredentialKey'] });
    connection.status = EnableBankingConnectionStatus.LINKED;
    connection.sessionId = `session-${who.appuserKey}`;
    await em.flush();
    return connection;
  };
  const secondHousehold = async (): Promise<Household> => seedHousehold(db.em());

  beforeEach(() => {
    provider.calls = [];
    reported.events = [];
    keyFiles.files = {};
    vi.stubEnv('ENABLE_BANKING_APP_ID', '');
    vi.stubEnv('ENABLE_BANKING_PRIVATE_KEY_FILE', '');
    vi.stubEnv('ENABLE_BANKING_PRODUCTION_CONTRACT', '');
    vi.stubEnv('BANK_PROVIDERS', 'enable_banking');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('on a single-household instance', () => {
    it('lets a new user list banks and start a link without credentials of their own', async () => {
      configureInstanceCredential();
      const household = await seedHousehold(db.em());

      expect((await listBanks(household.appuser)).status).toBe(200);
      const started = await startLink(household.appuser);

      expect(started.status).toBe(200);
      expect(started.body).toEqual({ redirectUrl: 'https://bank.example/consent' });
      expect(signedAs('listInstitutions')).toEqual([INSTANCE_APP_ID, INSTANCE_APP_ID]);
      expect(signedAs('startAuthorization')).toEqual([INSTANCE_APP_ID]);
      const connection = await linkedConnectionOf(household.appuser);
      expect(connection.enableBankingCredentialKey).toBeNull();
      expect(connection.bankConnectionKey?.credentialReference).toBe('instance');
    });

    it('lets the household partner link with it too', async () => {
      configureInstanceCredential();
      const household = await seedHousehold(db.em());
      const partner = await addPartner(db.em(), household);

      expect((await startLink(partner)).status).toBe(200);
      expect(await credentialsFor(partner)).toBe('instance');
    });

    it('counts households, not people: a household of several members is still the one household', async () => {
      configureInstanceCredential();
      const household = await seedHousehold(db.em());
      const people = [
        await addPartner(db.em(), household, { role: HouseholdRole.ADMIN }),
        await addPartner(db.em(), household),
        await addPartner(db.em(), household, { role: HouseholdRole.VIEWER }),
      ];

      for (const person of [household.appuser, ...people]) {
        expect(await credentialsFor(person)).toBe('instance');
      }
    });

    it('stops counting a household whose only member joined another one', async () => {
      configureInstanceCredential();
      const household = await seedHousehold(db.em());
      const joined = await secondHousehold();
      expect(await credentialsFor(household.appuser)).toBe('user');

      await db.em().nativeUpdate(AppuserTenant, { tenantKey: joined.tenant }, { recordActive: false });
      const em = db.em();
      em.create(AppuserTenant, { appuserKey: getRef(em, Appuser, joined.appuser.appuserKey), recordActive: true, role: HouseholdRole.MEMBER, tenantKey: getRef(em, Tenant, household.tenant.tenantKey) }, { partial: true });
      await em.flush();

      expect(await credentialsFor(household.appuser)).toBe('instance');
    });

    it('tells the client the caller can link without credentials', async () => {
      configureInstanceCredential();
      const household = await seedHousehold(db.em());

      expect(await credentialsFor(household.appuser)).toBe('instance');
    });

    it('asks for the user\'s own credential when the instance has none, as before', async () => {
      const household = await seedHousehold(db.em());

      expect((await listBanks(household.appuser)).status).toBe(400);
      expect((await startLink(household.appuser)).status).toBe(400);
      expect(await credentialsFor(household.appuser)).toBe('user');
      expect(provider.calls).toEqual([]);
    });

    it('is off when the operator disabled Enable Banking in BANK_PROVIDERS', async () => {
      configureInstanceCredential();
      vi.stubEnv('BANK_PROVIDERS', 'none');
      const household = await seedHousehold(db.em());

      expect(await credentialsFor(household.appuser)).toBe('user');
    });
  });

  describe('with a second household', () => {
    it('refuses the instance credential to both households while neither has linked with it', async () => {
      configureInstanceCredential();
      const first = await seedHousehold(db.em());
      const second = await secondHousehold();

      for (const household of [first, second]) {
        expect((await listBanks(household.appuser)).status).toBe(400);
        expect((await startLink(household.appuser)).status).toBe(400);
        expect(await credentialsFor(household.appuser)).toBe('user');
      }
      expect(provider.calls).toEqual([]);
    });

    it('keeps it for the household that linked first, and refuses the newcomer', async () => {
      configureInstanceCredential();
      const first = await seedHousehold(db.em());
      expect((await startLink(first.appuser)).status).toBe(200);
      await linkedConnectionOf(first.appuser);

      const second = await secondHousehold();

      expect(await credentialsFor(first.appuser)).toBe('instance');
      expect((await startLink(first.appuser)).status).toBe(200);
      expect(await credentialsFor(second.appuser)).toBe('user');
      expect((await startLink(second.appuser)).status).toBe(400);
      expect((await listBanks(second.appuser)).status).toBe(400);
    });

    it('lets everyone use it once the operator declares a production contract', async () => {
      configureInstanceCredential();
      vi.stubEnv('ENABLE_BANKING_PRODUCTION_CONTRACT', 'true');
      const first = await seedHousehold(db.em());
      const second = await secondHousehold();

      for (const household of [first, second]) {
        expect(await credentialsFor(household.appuser)).toBe('instance');
        expect((await startLink(household.appuser)).status).toBe(200);
      }
      expect(signedAs('startAuthorization')).toEqual([INSTANCE_APP_ID, INSTANCE_APP_ID]);
    });

    it('lets the newcomer link with their own credential', async () => {
      configureInstanceCredential();
      const first = await seedHousehold(db.em());
      expect((await startLink(first.appuser)).status).toBe(200);
      const second = await secondHousehold();

      expect((await saveOwnCredential(second.appuser)).status).toBe(200);
      provider.calls = [];

      expect((await startLink(second.appuser)).status).toBe(200);
      expect(signedAs('startAuthorization')).toEqual([`own-app-${second.appuser.appuserKey}`]);
    });

    it('does not count the read-only demo household', async () => {
      configureInstanceCredential();
      const household = await seedHousehold(db.em());
      const demo = await secondHousehold();
      await db.em().nativeUpdate(Tenant, { tenantKey: demo.tenant.tenantKey }, { tenantType: TenantType.DEMO });

      expect(await credentialsFor(household.appuser)).toBe('instance');
      expect(await credentialsFor(demo.appuser)).toBe('user');
    });

    it('does not count a household nobody belongs to any more', async () => {
      configureInstanceCredential();
      const household = await seedHousehold(db.em());
      const left = await secondHousehold();
      await db.em().nativeUpdate(AppuserTenant, { tenantKey: left.tenant }, { recordActive: false });

      expect(await credentialsFor(household.appuser)).toBe('instance');
    });
  });

  describe('a connection already made with the instance credential', () => {
    const syncOf = async (connection: EnableBankingConnection) => {
      const bankConnection = await db.em().findOneOrFail(BankConnection, { bankConnectionKey: connection.bankConnectionKey?.bankConnectionKey });
      const enableBanking = getBankProvider('enable_banking');
      if (!enableBanking) throw new Error('Enable Banking is not enabled');
      return { preflight: () => enableBanking.preflight?.(bankConnectionRef(bankConnection)), sessionStatus: () => enableBanking.getSessionStatus(bankConnectionRef(bankConnection)) };
    };

    it('keeps syncing after a second household appears', async () => {
      configureInstanceCredential();
      const first = await seedHousehold(db.em());
      expect((await startLink(first.appuser)).status).toBe(200);
      const connection = await linkedConnectionOf(first.appuser);
      await secondHousehold();
      provider.calls = [];

      const sync = await syncOf(connection);
      await expect(sync.preflight()).resolves.toBeUndefined();
      expect(await sync.sessionStatus()).toBe('active');
      expect(signedAs('getSession')).toEqual([INSTANCE_APP_ID]);
    });

    it('keeps syncing with the instance credential after the user adds their own', async () => {
      configureInstanceCredential();
      const household = await seedHousehold(db.em());
      expect((await startLink(household.appuser)).status).toBe(200);
      const connection = await linkedConnectionOf(household.appuser);
      expect((await saveOwnCredential(household.appuser)).status).toBe(200);
      provider.calls = [];

      expect(await (await syncOf(connection)).sessionStatus()).toBe('active');
      expect(signedAs('getSession')).toEqual([INSTANCE_APP_ID]);
    });

    it('asks the user to reconnect once the operator removes the instance credential', async () => {
      configureInstanceCredential();
      const household = await seedHousehold(db.em());
      expect((await startLink(household.appuser)).status).toBe(200);
      const connection = await linkedConnectionOf(household.appuser);
      vi.stubEnv('ENABLE_BANKING_APP_ID', '');
      vi.stubEnv('ENABLE_BANKING_PRIVATE_KEY_FILE', '');

      await expect((await syncOf(connection)).preflight()).rejects.toBeInstanceOf(UserActionRequiredError);
    });

    it('completes the consent callback with the instance credential', async () => {
      configureInstanceCredential();
      const household = await seedHousehold(db.em());
      expect((await startLink(household.appuser)).status).toBe(200);
      const { state } = await db.em().findOneOrFail(EnableBankingConnection, { appuserKey: household.appuser });
      provider.calls = [];

      const enableBanking = getBankProvider('enable_banking');
      await enableBanking?.completeConnection({ code: 'code-1', state });

      expect(signedAs('exchangeSession')).toEqual([INSTANCE_APP_ID]);
    });
  });

  describe('a user\'s own credential', () => {
    it('wins over the instance credential for new links', async () => {
      configureInstanceCredential();
      const household = await seedHousehold(db.em());
      expect((await saveOwnCredential(household.appuser)).status).toBe(200);
      provider.calls = [];

      expect((await listBanks(household.appuser)).status).toBe(200);
      expect((await startLink(household.appuser)).status).toBe(200);

      const ownApp = `own-app-${household.appuser.appuserKey}`;
      expect(signedAs('listInstitutions')).toEqual([ownApp, ownApp]);
      expect(signedAs('startAuthorization')).toEqual([ownApp]);
      const connection = await linkedConnectionOf(household.appuser);
      expect(connection.enableBankingCredentialKey).not.toBeNull();
    });

    it('is personal: a partner without one still links with the instance credential', async () => {
      configureInstanceCredential();
      const household = await seedHousehold(db.em());
      const partner = await addPartner(db.em(), household);
      expect((await saveOwnCredential(household.appuser)).status).toBe(200);
      provider.calls = [];

      expect((await startLink(partner)).status).toBe(200);
      expect(signedAs('startAuthorization')).toEqual([INSTANCE_APP_ID]);
    });
  });

  describe('the private key', () => {
    it('never reaches a response, a log line or an error report', async () => {
      const logged: unknown[] = [];
      for (const level of ['debug', 'error', 'fatal', 'info', 'trace', 'warn'] as const) {
        vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => { logged.push(args); });
      }
      for (const level of ['debug', 'error', 'info', 'log', 'warn'] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logged.push(args); });
      }
      configureInstanceCredential();
      const first = await seedHousehold(db.em());
      const second = await secondHousehold();
      const json = vi.fn();
      getInstance(mockReq(), mockRes({ json }));
      // Under the contract flag the first household links; without it, the second is refused.
      vi.stubEnv('ENABLE_BANKING_PRODUCTION_CONTRACT', 'true');
      const responses = [
        await startLink(first.appuser),
        await listBanks(first.appuser),
        await user.as(first.appuser).get('/v1/user/me/profile'),
        await user.as(first.appuser).get('/v1/user/enable-banking-credential'),
      ];
      vi.stubEnv('ENABLE_BANKING_PRODUCTION_CONTRACT', '');
      responses.push(await startLink(second.appuser), await listBanks(second.appuser), await saveOwnCredential(second.appuser));
      responses.push(await user.as(second.appuser).get('/v1/user/enable-banking-credential'));
      // A key file broken under a running process is logged by its path only.
      keyFiles.files = { '/run/secrets/other': INSTANCE_PEM.replace('BEGIN PRIVATE KEY', 'BEGIN PRIVATE KEX') };
      vi.stubEnv('ENABLE_BANKING_PRIVATE_KEY_FILE', '/run/secrets/other');
      responses.push(await startLink(first.appuser));

      const seen = JSON.stringify([json.mock.calls, responses.map((response) => [response.text, response.headers]), logged, reported.events]);
      expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 400, 400, 200, 200, 400]);
      for (const line of KEY_LINES) expect(seen).not.toContain(line);
      expect(seen).toContain('/run/secrets/other');
    });
  });
});
