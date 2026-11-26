import { createPrivateKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';

import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['CREDENTIAL_ENCRYPTION_KEY_V1'] = Buffer.alloc(32, 7).toString('base64');
});
/** What reached the error tracker. */
const reported = vi.hoisted(() => ({ events: [] as unknown[] }));
vi.mock('@sentry/node', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sentry/node')>()),
  addBreadcrumb: (...args: unknown[]) => { reported.events.push(args); },
  captureException: (...args: unknown[]) => { reported.events.push(args); return 'event'; },
  captureMessage: (...args: unknown[]) => { reported.events.push(args); return 'event'; },
}));
vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
/** The session double, with a session age a test can set to make it stale. */
const session = vi.hoisted(() => ({ ageMs: 0 }));
vi.mock('@service/auth/better-auth', async () => {
  const double = (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession();
  return {
    ...double,
    getAuthSession: async (headers: Record<string, string | string[] | undefined>) => {
      const found = await double.getAuthSession(headers);
      return found && { ...found, session: { ...found.session, createdAt: new Date(Date.now() - session.ageMs) } };
    },
  };
});

/**
 * A stand-in for Enable Banking's API behind the real client: each request's JWT must name a
 * registered application (`kid`) and verify against the certificate registered for it, as
 * Enable Banking checks it. `applications` is what the person registered in the Control Panel:
 * `accountsLinked` false is a Restricted Production application not activated yet, which Enable
 * Banking answers with `NO_ACCOUNTS_ADDED`, and `applicationEndpoint` false an application
 * `GET /application` is not offered to.
 */
interface RegisteredApplication { accountsLinked: boolean; applicationEndpoint: boolean; certificatePem: string; environment?: string }
const enableBanking = vi.hoisted(() => ({
  applications: new Map<string, RegisteredApplication>(),
  calls: [] as { kid: string; path: string }[],
}));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const jose = await import('jose');
  const refuse = (status: number, error: string) => {
    const response = { config: { headers: new actual.AxiosHeaders() }, data: { error, message: 'refused' }, headers: {}, status, statusText: '' };
    return Promise.reject(new actual.AxiosError('refused', 'ERR_BAD_REQUEST', undefined, undefined, response));
  };
  const handle = async (path: string, headers: Record<string, string> | undefined) => {
    const token = headers?.['Authorization']?.replace(/^Bearer /u, '') ?? '';
    const { kid } = jose.decodeProtectedHeader(token);
    const application = kid ? enableBanking.applications.get(kid) : undefined;
    if (!kid || !application) return refuse(401, 'UNAUTHORIZED_ACCESS');
    try {
      await jose.jwtVerify(token, await jose.importX509(application.certificatePem, 'RS256'), { audience: 'api.enablebanking.com', issuer: 'enablebanking.com' });
    } catch {
      return refuse(401, 'UNAUTHORIZED_ACCESS');
    }
    enableBanking.calls.push({ kid, path });
    if (path === '/application') {
      if (!application.applicationEndpoint) return refuse(404, 'WRONG_REQUEST_PARAMETERS');
      return { data: { environment: application.environment, kid, name: 'WonderMoney' } };
    }
    if (!application.accountsLinked) return refuse(403, 'NO_ACCOUNTS_ADDED');
    if (path === '/aspsps') return { data: { aspsps: [{ country: 'PT', logo: '', maximum_consent_validity: 7_776_000, name: 'Banco Exemplo' }] } };
    if (path === '/auth') return { data: { authorization_id: 'auth-1', psu_id_hash: 'hash', url: 'https://bank.example/consent' } };
    if (path === '/sessions') return { data: { access: { valid_until: '2027-06-01T00:00:00.000Z' }, accounts: [], session_id: `session-${kid}` } };
    return refuse(404, 'WRONG_REQUEST_PARAMETERS');
  };
  return {
    ...actual,
    default: {
      ...actual.default,
      create: () => ({
        get: (path: string, config?: { headers?: Record<string, string> }) => handle(path, config?.headers),
        post: (path: string, _body: unknown, config?: { headers?: Record<string, string> }) => handle(path, config?.headers),
      }),
    },
  };
});

import { RequestContext } from '@mikro-orm/postgresql';

import { addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { handleBankSyncAlertSweepJob } from '@app/jobs/bank-sync-alert.worker';
import { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { EnableBankingCredential, EnableBankingCredentialStatus } from '@entity/EnableBankingCredential';
import bankingRoutes from '@route/banking';
import userRoutes from '@route/user';
import { getBankProvider } from '@service/bank-providers/registry';
import { decryptSecret } from '@service/crypto/secret-encryption.service';
import { writeHouseholdExport } from '@service/data-export/household-export';
import { generateEnableBankingKeyPair } from '@service/enable-banking/enable-banking-certificate';
import { EnableBankingCredentialService, enableBankingCredentialService } from '@service/enable-banking/enable-banking-credential.service';
import { encodeEnableBankingInstitutionId } from '@utils/enable-banking-institution-id';
import { ERROR_CODE } from '@utils/errors';
import logger from '@utils/logger';

/*
 * "Let WonderMoney create the key": the server generates the key pair and hands out only the
 * certificate, the person registers it with Enable Banking and pastes back the application ID,
 * and links banks with it. The private key never leaves the server.
 */

const BANK_ID = encodeEnableBankingInstitutionId({ country: 'PT', name: 'Banco Exemplo' });
const CERTIFICATE_PATH = '/v1/user/enable-banking-credential/certificate';
const ACTIVATE_PATH = '/v1/user/enable-banking-credential/activate';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('a server-generated Enable Banking key', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const user = tenantHttp('/v1/user', userRoutes);
  const banking = tenantHttp('/v1/banking', bankingRoutes);

  const createCertificate = (household: Household) => user.as(household.appuser).post(CERTIFICATE_PATH);
  const activate = (household: Household, applicationId: string) => user.as(household.appuser).post(ACTIVATE_PATH).send({ applicationId });
  const statusOf = async (household: Household) => (await user.as(household.appuser).get('/v1/user/enable-banking-credential')).body as null | { applicationId: null | string; pending: null | { expiresAt: string }; status: string };
  /** The person registers the certificate in Enable Banking's Control Panel and gets an ID back. */
  const register = (certificatePem: string, application: Partial<Omit<RegisteredApplication, 'certificatePem'>> = {}) => {
    const applicationId = randomUUID();
    enableBanking.applications.set(applicationId, { accountsLinked: true, applicationEndpoint: true, certificatePem, environment: 'PRODUCTION', ...application });
    return applicationId;
  };
  const paste = (household: Household, applicationId: string, privateKeyPem: string) => user.as(household.appuser).post('/v1/user/enable-banking-credential').send({ applicationId, privateKeyPem });
  const certificateFor = async (household: Household) => ((await createCertificate(household)).body as { certificatePem: string }).certificatePem;
  /** Which applications signed the session exchange when the bank sent the person back for this link. */
  const completedWith = async (state: string) => {
    enableBanking.calls = [];
    await getBankProvider('enable_banking')?.completeConnection({ code: 'code-1', state });
    return enableBanking.calls.filter((call) => call.path === '/sessions').map((call) => call.kid);
  };
  const rowsOf = (household: Household) => db.em().fork().find(EnableBankingCredential, { appuserKey: household.appuser }, { orderBy: { enableBankingCredentialKey: 'asc' } });
  /** The private key the server stored, decrypted: what must never be seen outside it. */
  const storedKeyLines = (row: EnableBankingCredential) => {
    const pem = decryptSecret({ authTag: row.privateKeyAuthTag, ciphertext: row.privateKeyCiphertext, iv: row.privateKeyIv, keyVersion: row.encryptionKeyVersion });
    return [...pem.split('\n').filter((line) => line.length === 64).slice(0, 6), row.privateKeyCiphertext];
  };

  beforeEach(() => {
    enableBanking.applications.clear();
    enableBanking.calls = [];
    reported.events = [];
    session.ageMs = 0;
    vi.stubEnv('ENABLE_BANKING_APP_ID', '');
    vi.stubEnv('ENABLE_BANKING_PRIVATE_KEY_FILE', '');
    vi.stubEnv('BANK_PROVIDERS', 'enable_banking');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('takes a person from certificate to a bank link without a private key ever leaving the server', async () => {
    const household = await seedHousehold(db.em());

    const created = await createCertificate(household);
    expect(created.status).toBe(201);
    const { certificatePem, expiresAt } = created.body as { certificatePem: string; expiresAt: string };
    expect(certificatePem).toMatch(/^-----BEGIN CERTIFICATE-----/u);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * DAY_MS);
    expect(await statusOf(household)).toMatchObject({ applicationId: null, pending: { expiresAt }, status: 'pending' });

    // Until it is activated, the pending key links nothing.
    expect((await banking.as(household.appuser).get('/v1/banking/bank?country=PT')).status).not.toBe(200);

    const applicationId = register(certificatePem);
    const activated = await activate(household, applicationId);
    expect(activated.status).toBe(200);
    expect(activated.body).toMatchObject({ applicationId, pending: null, status: 'active' });

    expect((await banking.as(household.appuser).get('/v1/banking/bank?country=PT')).status).toBe(200);
    const started = await banking.as(household.appuser).get(`/v1/banking/bank/${BANK_ID}/start`);
    expect(started.status).toBe(200);
    expect(started.body).toEqual({ redirectUrl: 'https://bank.example/consent' });

    // Every call verified against the uploaded certificate, as the application it was registered as.
    expect(enableBanking.calls).toEqual([
      { kid: applicationId, path: '/application' },
      { kid: applicationId, path: '/aspsps' },
      { kid: applicationId, path: '/aspsps' },
      { kid: applicationId, path: '/aspsps' },
      { kid: applicationId, path: '/auth' },
    ]);
    const [credential] = await rowsOf(household);
    const connection = await db.em().fork().findOneOrFail(EnableBankingConnection, { appuserKey: household.appuser });
    expect(connection.enableBankingCredentialKey?.enableBankingCredentialKey).toBe(credential?.enableBankingCredentialKey);
  });

  it('never puts the private key in a response, a log line, an error report or the data export', async () => {
    const logged: unknown[] = [];
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => { logged.push(args); });
    }
    const household = await seedHousehold(db.em());

    const responses: unknown[] = [];
    const created = await createCertificate(household);
    responses.push(created.body, await statusOf(household));
    const { certificatePem } = created.body as { certificatePem: string };
    // Every way activation can end: wrong application, not activated, then activated.
    responses.push((await activate(household, randomUUID())).body);
    responses.push((await activate(household, register(certificatePem, { accountsLinked: false }))).body);
    responses.push((await activate(household, register(certificatePem))).body, await statusOf(household));
    const [row] = await rowsOf(household);
    if (!row) throw new Error('no credential stored');

    const chunks: Buffer[] = [];
    const output = new PassThrough();
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    await writeHouseholdExport(db.em().fork(), { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey }, output);
    const archive = Object.values(unzipSync(new Uint8Array(Buffer.concat(chunks)))).map((entry) => strFromU8(entry)).join('\n');

    const seen = [JSON.stringify(responses), JSON.stringify(logged), JSON.stringify(reported.events), archive].join('\n');
    expect(logged.length).toBeGreaterThan(0);
    expect(seen).not.toContain('PRIVATE KEY');
    for (const line of storedKeyLines(row)) expect(seen).not.toContain(line);
  });

  it.each([
    ['an application ID Enable Banking does not know', () => randomUUID(), ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_FOUND],
    ['an application registered with another certificate', () => register(generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'pem', type: 'spki' })), ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_FOUND],
    ['something that is not an application ID', () => 'my bank app', ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_FOUND],
  ])('refuses %s, and keeps the key pending', async (_case, applicationIdFor, code) => {
    const household = await seedHousehold(db.em());
    await createCertificate(household);

    const refused = await activate(household, applicationIdFor());

    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code });
    expect(await statusOf(household)).toMatchObject({ status: 'pending' });
  });

  it.each([
    ['a Sandbox application', { environment: 'SANDBOX' }, ERROR_CODE.ENABLE_BANKING_APPLICATION_SANDBOX],
    ['a Production application not activated yet', { accountsLinked: false }, ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_ACTIVATED],
  ])('refuses %s with its own code, and activates once it is fixed', async (_case, application, code) => {
    const household = await seedHousehold(db.em());
    const { certificatePem } = (await createCertificate(household)).body as { certificatePem: string };
    const applicationId = register(certificatePem, application);

    const refused = await activate(household, applicationId);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code });

    enableBanking.applications.set(applicationId, { accountsLinked: true, applicationEndpoint: true, certificatePem, environment: 'PRODUCTION' });
    expect((await activate(household, applicationId)).body).toMatchObject({ status: 'active' });
  });

  it('lets a pending key lapse after seven days, unused', async () => {
    const household = await seedHousehold(db.em());
    const { certificatePem } = (await createCertificate(household)).body as { certificatePem: string };
    const em = db.em().fork();
    await em.nativeUpdate(EnableBankingCredential, { appuserKey: household.appuser }, { createdAt: new Date(Date.now() - 7 * DAY_MS - 60_000) });

    expect(await statusOf(household)).toBeNull();
    const refused = await activate(household, register(certificatePem));
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: ERROR_CODE.ENABLE_BANKING_PENDING_CREDENTIAL_MISSING });
    expect(await enableBankingCredentialService.resolveForNewLink(household.appuser.appuserKey, household.tenant.tenantKey)).toBeNull();
    expect(enableBanking.calls).toEqual([]);
  });

  it('is still activated on its last day', async () => {
    const household = await seedHousehold(db.em());
    const { certificatePem } = (await createCertificate(household)).body as { certificatePem: string };
    await db.em().fork().nativeUpdate(EnableBankingCredential, { appuserKey: household.appuser }, { createdAt: new Date(Date.now() - 7 * DAY_MS + 60_000) });

    expect((await activate(household, register(certificatePem))).body).toMatchObject({ status: 'active' });
  });

  it('replaces the pending key when asked again, so only the latest certificate activates', async () => {
    const household = await seedHousehold(db.em());
    const first = (await createCertificate(household)).body as { certificatePem: string };
    const second = (await createCertificate(household)).body as { certificatePem: string };

    const rows = await rowsOf(household);
    expect(rows.map((row) => row.status)).toEqual([EnableBankingCredentialStatus.PENDING]);
    expect((await activate(household, register(first.certificatePem))).body).toMatchObject({ code: ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_FOUND });
    expect((await activate(household, register(second.certificatePem))).body).toMatchObject({ status: 'active' });
  });

  it('never touches the active credential while a replacement is pending, and keeps old links on it', async () => {
    const household = await seedHousehold(db.em());
    const firstCertificate = ((await createCertificate(household)).body as { certificatePem: string }).certificatePem;
    const firstApplication = register(firstCertificate);
    await activate(household, firstApplication);
    await banking.as(household.appuser).get(`/v1/banking/bank/${BANK_ID}/start`);
    const [active] = await rowsOf(household);

    const replacement = ((await createCertificate(household)).body as { certificatePem: string }).certificatePem;
    await createCertificate(household);
    const replacementCertificate = ((await createCertificate(household)).body as { certificatePem: string }).certificatePem;
    expect(replacement).not.toBe(replacementCertificate);

    const [stillActive, pending, ...rest] = await rowsOf(household);
    expect(rest).toEqual([]);
    expect(stillActive).toMatchObject({ applicationId: firstApplication, privateKeyCiphertext: active?.privateKeyCiphertext, status: EnableBankingCredentialStatus.ACTIVE });
    expect(pending?.status).toBe(EnableBankingCredentialStatus.PENDING);
    expect(await statusOf(household)).toMatchObject({ applicationId: firstApplication, pending: { expiresAt: expect.any(String) as unknown }, status: 'active' });
    enableBanking.calls = [];
    await banking.as(household.appuser).get('/v1/banking/bank?country=PT');
    expect(enableBanking.calls).toEqual([{ kid: firstApplication, path: '/aspsps' }]);

    const secondApplication = register(replacementCertificate);
    expect((await activate(household, secondApplication)).body).toMatchObject({ applicationId: secondApplication, status: 'active' });
    enableBanking.calls = [];
    await banking.as(household.appuser).get('/v1/banking/bank?country=PT');
    expect(enableBanking.calls).toEqual([{ kid: secondApplication, path: '/aspsps' }]);
    const connection = await db.em().fork().findOneOrFail(EnableBankingConnection, { appuserKey: household.appuser });
    expect(connection.enableBankingCredentialKey?.enableBankingCredentialKey).toBe(active?.enableBankingCredentialKey);
    // The replaced credential is retired, but the link made with it still signs with it.
    const [retired] = await rowsOf(household);
    expect(retired?.deletedAt).toBeInstanceOf(Date);
    expect(await completedWith(connection.state)).toEqual([firstApplication]);
  });

  it('removes the key for good after a replacement: the earlier one never comes back', async () => {
    const household = await seedHousehold(db.em());
    await activate(household, register(await certificateFor(household)));
    await banking.as(household.appuser).get(`/v1/banking/bank/${BANK_ID}/start`);
    await activate(household, register(await certificateFor(household)));

    expect((await user.as(household.appuser).delete('/v1/user/enable-banking-credential')).status).toBe(204);

    expect(await statusOf(household)).toBeNull();
    expect(await enableBankingCredentialService.resolveForNewLink(household.appuser.appuserKey, household.tenant.tenantKey)).toBeNull();
    expect((await banking.as(household.appuser).get('/v1/banking/bank?country=PT')).status).toBe(400);
    expect((await rowsOf(household)).every((row) => row.deletedAt instanceof Date)).toBe(true);
    // Removing again, with nothing left, is not an error.
    expect((await user.as(household.appuser).delete('/v1/user/enable-banking-credential')).status).toBe(204);
  });

  it('keeps old links on the generated key when a .pem key is pasted after it', async () => {
    const household = await seedHousehold(db.em());
    const generatedApplication = register(await certificateFor(household));
    await activate(household, generatedApplication);
    await banking.as(household.appuser).get(`/v1/banking/bank/${BANK_ID}/start`);
    const { state } = await db.em().fork().findOneOrFail(EnableBankingConnection, { appuserKey: household.appuser });

    const pasted = await generateEnableBankingKeyPair();
    const pastedApplication = register(pasted.certificatePem);
    expect((await paste(household, pastedApplication, pasted.privateKeyPem)).status).toBe(200);

    expect(await statusOf(household)).toMatchObject({ applicationId: pastedApplication, status: 'active' });
    enableBanking.calls = [];
    await banking.as(household.appuser).get('/v1/banking/bank?country=PT');
    expect(enableBanking.calls).toEqual([{ kid: pastedApplication, path: '/aspsps' }]);
    expect(await completedWith(state)).toEqual([generatedApplication]);
  });

  it('keeps old links on the earlier pasted key when another is pasted', async () => {
    const household = await seedHousehold(db.em());
    const first = await generateEnableBankingKeyPair();
    const firstApplication = register(first.certificatePem);
    await paste(household, firstApplication, first.privateKeyPem);
    await banking.as(household.appuser).get(`/v1/banking/bank/${BANK_ID}/start`);
    const { state } = await db.em().fork().findOneOrFail(EnableBankingConnection, { appuserKey: household.appuser });

    const second = await generateEnableBankingKeyPair();
    await paste(household, register(second.certificatePem), second.privateKeyPem);

    expect(await completedWith(state)).toEqual([firstApplication]);
  });

  it('accepts a PKCS#1 private key as pasted', async () => {
    const household = await seedHousehold(db.em());
    const pair = await generateEnableBankingKeyPair();
    const pkcs1 = createPrivateKey(pair.privateKeyPem).export({ format: 'pem', type: 'pkcs1' });
    expect(pkcs1).toContain('BEGIN RSA PRIVATE KEY');

    const saved = await paste(household, register(pair.certificatePem), pkcs1);

    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ status: 'active' });
  });

  it('activates an application GET /application is not offered to, on the bank list check alone', async () => {
    const household = await seedHousehold(db.em());
    const applicationId = register(await certificateFor(household), { applicationEndpoint: false });

    expect((await activate(household, applicationId)).body).toMatchObject({ applicationId, status: 'active' });
  });

  it('takes a Sandbox application only when the operator allows sandboxes', async () => {
    const household = await seedHousehold(db.em());
    const pair = await generateEnableBankingKeyPair();
    const applicationId = register(pair.certificatePem, { environment: 'SANDBOX' });

    expect((await paste(household, applicationId, pair.privateKeyPem)).body).toMatchObject({ code: ERROR_CODE.ENABLE_BANKING_APPLICATION_SANDBOX });
    vi.stubEnv('ENABLE_BANKING_ALLOW_SANDBOX', 'true');
    expect((await paste(household, applicationId, pair.privateKeyPem)).body).toMatchObject({ applicationId, status: 'active' });
  });

  it('activates nothing when the pending key was replaced while it was being checked', async () => {
    const household = await seedHousehold(db.em());
    await createCertificate(household);
    const stale = await enableBankingCredentialService.getLivePendingCredential(household.appuser.appuserKey);
    if (!stale) throw new Error('no pending credential');
    await createCertificate(household);

    await expect(enableBankingCredentialService.activatePendingCredential(stale, randomUUID())).rejects.toMatchObject({ code: ERROR_CODE.ENABLE_BANKING_PENDING_CREDENTIAL_MISSING, status: 409 });
    expect(await statusOf(household)).toMatchObject({ status: 'pending' });
    expect((await rowsOf(household)).map((row) => row.status)).toEqual([EnableBankingCredentialStatus.PENDING]);
  });

  it('refuses a stored credential other than a pending one without an application ID', async () => {
    const household = await seedHousehold(db.em());
    await createCertificate(household);
    const em = db.em().fork();

    await expect(em.nativeUpdate(EnableBankingCredential, { appuserKey: household.appuser }, { status: EnableBankingCredentialStatus.ACTIVE })).rejects.toThrow(/enable_banking_credential_application_id_check/u);
  });

  it('deletes lapsed pending keys in the daily bank sync sweep, and keeps the rest', async () => {
    const lapsed = await seedHousehold(db.em());
    const waiting = await seedHousehold(db.em());
    const active = await seedHousehold(db.em());
    await createCertificate(lapsed);
    await createCertificate(waiting);
    await activate(active, register(await certificateFor(active)));
    await db.em().fork().nativeUpdate(EnableBankingCredential, { appuserKey: [lapsed.appuser, active.appuser] }, { createdAt: new Date(Date.now() - 8 * DAY_MS) });

    await RequestContext.create(db.orm.em, () => handleBankSyncAlertSweepJob({ enqueue: { send: () => Promise.resolve(null), sendAfter: () => Promise.resolve(null) }, logger: { info: () => undefined, warn: () => undefined } }));

    expect(await rowsOf(lapsed)).toEqual([]);
    expect((await rowsOf(waiting)).map((row) => row.status)).toEqual([EnableBankingCredentialStatus.PENDING]);
    expect((await rowsOf(active)).map((row) => row.status)).toEqual([EnableBankingCredentialStatus.ACTIVE]);
  });

  it("still decides the day's alerts when the purge fails, and logs no key material", async () => {
    const household = await seedHousehold(db.em());
    await createCertificate(household);
    const [row] = await rowsOf(household);
    if (!row) throw new Error('no credential stored');
    vi.spyOn(EnableBankingCredentialService.prototype, 'purgeLapsedPendingCredentials').mockRejectedValue(new Error('connection reset'));
    const logged = { info: [] as unknown[], warn: [] as unknown[] };

    const result = await RequestContext.create(db.orm.em, () => handleBankSyncAlertSweepJob({
      enqueue: { send: () => Promise.resolve(null), sendAfter: () => Promise.resolve(null) },
      logger: { info: (...args: unknown[]) => { logged.info.push(args); }, warn: (...args: unknown[]) => { logged.warn.push(args); } },
    }));

    expect(result).toBeDefined();
    expect(JSON.stringify(logged.warn)).toContain('connection reset');
    expect(JSON.stringify(logged.info)).toContain('Bank sync alert sweep finished');
    for (const line of storedKeyLines(row)) expect(JSON.stringify(logged)).not.toContain(line);
  });

  it("keeps a member's keys from the rest of the household", async () => {
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);
    const asPartner = { ...household, appuser: partner };
    await activate(household, register(await certificateFor(household)));
    const { certificatePem } = (await createCertificate(household)).body as { certificatePem: string };

    expect(await statusOf(asPartner)).toBeNull();
    expect((await activate(asPartner, register(certificatePem))).status).toBe(409);
    expect((await user.as(partner).delete('/v1/user/enable-banking-credential')).status).toBe(204);

    expect(await statusOf(household)).toMatchObject({ pending: { expiresAt: expect.any(String) as unknown }, status: 'active' });
    expect(await enableBankingCredentialService.resolveForNewLink(partner.appuserKey, household.tenant.tenantKey)).toBeNull();
  });

  it("keeps each person's pending key to themself", async () => {
    const owner = await seedHousehold(db.em());
    const neighbour = await seedHousehold(db.em());
    const { certificatePem } = (await createCertificate(owner)).body as { certificatePem: string };

    const refused = await activate(neighbour, register(certificatePem));

    expect(refused.status).toBe(409);
    expect(await statusOf(neighbour)).toBeNull();
    expect(await statusOf(owner)).toMatchObject({ status: 'pending' });
  });

  it('removes a pending key along with the active one', async () => {
    const household = await seedHousehold(db.em());
    await activate(household, register(((await createCertificate(household)).body as { certificatePem: string }).certificatePem));
    await createCertificate(household);

    expect((await user.as(household.appuser).delete('/v1/user/enable-banking-credential')).status).toBe(204);

    expect(await statusOf(household)).toBeNull();
    const rows = await rowsOf(household);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).toBeInstanceOf(Date);
  });

  it('needs a fresh session for both steps', async () => {
    const household = await seedHousehold(db.em());
    const { certificatePem } = (await createCertificate(household)).body as { certificatePem: string };
    session.ageMs = 25 * 60 * 60 * 1000;

    for (const response of [await createCertificate(household), await activate(household, register(certificatePem))]) {
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: ERROR_CODE.SESSION_NOT_FRESH });
    }
  });

  it('limits how many certificates a person can create in an hour', async () => {
    const household = await seedHousehold(db.em());
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt++) statuses.push((await createCertificate(household)).status);

    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
