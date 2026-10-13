import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { NordigenRequisition } from '@entity/NordigenRequisition';

// The controller imports `../app.js` (DI), which transitively pulls env-throwing modules.
// Most tests here only exercise pure `__testOnly` helpers, so stub the app
// module; the `getBankConnections` describe block below drives `DI.em.find` through the
// same hoisted mock.
const mocks = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock('@app/app', () => ({ DI: { em: { find: mocks.find } } }));

import { __testOnly, getBankConnections } from '../banking-connections';

const {
  areAllAccountsRefreshed,
  computeEnableBankingStatus,
  computeFreshnessAsOf,
  computeStatus,
  mapEnableBankingConnection,
  mapRequisition,
  resolveInstitutionName,
} = __testOnly;

type BankingAccount = Parameters<typeof computeStatus>[1][number];
type EnableBankingInput = Parameters<typeof computeEnableBankingStatus>[0];
type RequisitionInput = Parameters<typeof computeStatus>[0];

const baseAccount = (overrides: Partial<{ deletedAt: Date | null; institutionDisplayName: null | string; institutionName: null | string; refreshedAt: Date | null; transactionsRefreshedAt: Date | null; }> = {}): BankingAccount => ({
  accountFinancialInstitutionKey: overrides.institutionDisplayName !== undefined || overrides.institutionName !== undefined
    ? { displayName: overrides.institutionDisplayName ?? null, name: overrides.institutionName ?? null }
    : null,
  deletedAt: overrides.deletedAt ?? null,
  refreshedAt: overrides.refreshedAt ?? null,
  transactionsRefreshedAt: overrides.transactionsRefreshedAt ?? null,
});

const baseReq = (overrides: Partial<{ expiresAt: Date | null; status: 'created' | 'error' | 'expired' | 'linked' }> = {}): RequisitionInput => ({
  accounts: { getItems: () => [] as BankingAccount[] },
  expiresAt: overrides.expiresAt ?? null,
  status: (overrides.status ?? 'linked') as RequisitionInput['status'],
});

describe('RAD-246 status matrix', () => {
  beforeEach(() => vi.useRealTimers());

  it('created -> processing', () => {
    expect(computeStatus(baseReq({ status: 'created' }), [])).toBe('processing');
  });

  it('error -> error', () => {
    expect(computeStatus(baseReq({ status: 'error' }), [])).toBe('error');
  });

  it('expired -> expired', () => {
    expect(computeStatus(baseReq({ status: 'expired' }), [])).toBe('expired');
  });

  it('linked with no expiresAt -> error', () => {
    expect(computeStatus(baseReq({ expiresAt: null, status: 'linked' }), [])).toBe('error');
  });

  it('linked with invalid expiresAt -> error', () => {
    expect(computeStatus(baseReq({ expiresAt: new Date('not-a-date'), status: 'linked' }), [])).toBe('error');
  });

  it('linked with past expiresAt -> expired (no write)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    expect(computeStatus(baseReq({ expiresAt: new Date('2026-07-30T12:00:00.000Z'), status: 'linked' }), [])).toBe('expired');
  });

  it('linked with future expiresAt but no active accounts -> processing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    expect(computeStatus(baseReq({ expiresAt: new Date('2026-08-30T12:00:00.000Z'), status: 'linked' }), [])).toBe('processing');
  });

  it('linked with future expiresAt and an unrefreshed account -> processing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    const accounts = [baseAccount({ refreshedAt: null, transactionsRefreshedAt: null })];
    expect(computeStatus(baseReq({ expiresAt: new Date('2026-08-30T12:00:00.000Z'), status: 'linked' }), accounts)).toBe('processing');
  });

  it('linked with future expiresAt and all accounts refreshed -> connected', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    const accounts = [
      baseAccount({ refreshedAt: new Date('2026-07-30T10:00:00.000Z') }),
      baseAccount({ refreshedAt: null, transactionsRefreshedAt: new Date('2026-07-30T11:00:00.000Z') }),
    ];
    expect(computeStatus(baseReq({ expiresAt: new Date('2026-08-30T12:00:00.000Z'), status: 'linked' }), accounts)).toBe('connected');
  });

  it('linked with a soft-deleted account treats that account as unready', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    const accounts = [
      baseAccount({ refreshedAt: new Date('2026-07-30T10:00:00.000Z') }),
      baseAccount({ deletedAt: new Date('2026-07-30T12:00:00.000Z'), refreshedAt: new Date('2026-07-30T10:00:00.000Z') }),
    ];
    expect(areAllAccountsRefreshed(accounts)).toBe(false);
  });
});

describe('RAD-246 institution name resolution', () => {
  it('returns null when no account has a financial institution', () => {
    expect(resolveInstitutionName([baseAccount(), baseAccount()])).toBeNull();
  });

  it('returns the single human-safe display name when one account has it', () => {
    expect(resolveInstitutionName([baseAccount({ institutionDisplayName: 'Real Bank' })])).toBe('Real Bank');
  });

  it('does not fall back to the upstream provider id (name) when displayName is null', () => {
    expect(resolveInstitutionName([baseAccount({ institutionDisplayName: null, institutionName: 'SANDBOXFINANCE_SFIN0000' })])).toBeNull();
  });

  it('returns null when two accounts have different institution display names', () => {
    expect(resolveInstitutionName([
      baseAccount({ institutionDisplayName: 'Real Bank' }),
      baseAccount({ institutionDisplayName: 'Other Bank' }),
    ])).toBeNull();
  });

  it('returns null when the only displayName looks like a provider-id placeholder', () => {
    expect(resolveInstitutionName([baseAccount({ institutionDisplayName: 'SANDBOXFINANCE_SFIN0000' })])).toBeNull();
  });
});

describe('RAD-246 freshness', () => {
  it('returns null when no active account is refreshed', () => {
    expect(computeFreshnessAsOf([baseAccount(), baseAccount()])).toBeNull();
  });

  it('returns the minimum refreshedAt across active accounts', () => {
    const earlier = new Date('2026-07-30T10:00:00.000Z');
    const later = new Date('2026-07-30T11:00:00.000Z');
    expect(computeFreshnessAsOf([
      baseAccount({ refreshedAt: later }),
      baseAccount({ refreshedAt: earlier }),
    ])).toBe(earlier.toISOString());
  });

  it('falls back to transactionsRefreshedAt when refreshedAt is null', () => {
    const tx = new Date('2026-07-30T11:00:00.000Z');
    expect(computeFreshnessAsOf([baseAccount({ refreshedAt: null, transactionsRefreshedAt: tx })])).toBe(tx.toISOString());
  });

  it('ignores soft-deleted accounts when computing freshness', () => {
    const live = new Date('2026-07-30T10:00:00.000Z');
    const deleted = new Date('2026-07-29T08:00:00.000Z');
    expect(computeFreshnessAsOf([
      baseAccount({ refreshedAt: live }),
      baseAccount({ deletedAt: new Date('2026-07-29T09:00:00.000Z'), refreshedAt: deleted }),
    ])).toBe(live.toISOString());
  });
});

describe('RAD-246 DTO mapping (forbidden identifiers are never present)', () => {
  it('produces a fixed shape with no entity/provider fields', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    const req = baseReq({ expiresAt: new Date('2026-08-30T12:00:00.000Z'), status: 'linked' });
    const accounts = [
      baseAccount({
        institutionDisplayName: 'Real Bank',
        refreshedAt: new Date('2026-07-30T10:00:00.000Z'),
      }),
    ];
    const dto = mapRequisition({ ...req, accounts: { getItems: () => accounts } });
    expect(Object.keys(dto).sort()).toEqual(['accessType', 'dataFreshAsOf', 'expiresAt', 'institutionName', 'provider', 'status']);
    expect(dto.provider).toBe('GoCardless');
    expect(dto.accessType).toBe('open_banking');
    expect(dto.status).toBe('connected');
    expect(dto.institutionName).toBe('Real Bank');
    expect(dto.expiresAt).toBe(new Date('2026-08-30T12:00:00.000Z').toISOString());
    expect(dto.dataFreshAsOf).toBe(new Date('2026-07-30T10:00:00.000Z').toISOString());
  });

  it('returns null for institutionName when accounts have mixed display names', () => {
    const req = baseReq();
    const accounts = [
      baseAccount({ institutionDisplayName: 'Real Bank' }),
      baseAccount({ institutionDisplayName: 'Other Bank' }),
    ];
    const dto = mapRequisition({ ...req, accounts: { getItems: () => accounts } });
    expect(dto.institutionName).toBeNull();
  });
});

const baseEnableBankingConnection = (overrides: Partial<{ accessValidUntil: Date | null; aspspName: null | string; status: 'authorized' | 'created' | 'error' | 'expired' | 'linked' }> = {}): EnableBankingInput => ({
  accessValidUntil: overrides.accessValidUntil ?? null,
  accounts: { getItems: () => [] as BankingAccount[] },
  aspspName: 'aspspName' in overrides ? overrides.aspspName ?? null : 'Test Bank',
  status: (overrides.status ?? 'linked') as EnableBankingInput['status'],
});

describe('RAD-246 Enable Banking status matrix', () => {
  beforeEach(() => vi.useRealTimers());

  it('created -> processing (no exact vocabulary match; same value as GoCardless CR)', () => {
    expect(computeEnableBankingStatus(baseEnableBankingConnection({ status: 'created' }), [])).toBe('processing');
  });

  it('authorized -> processing (no exact vocabulary match; still pre-session)', () => {
    expect(computeEnableBankingStatus(baseEnableBankingConnection({ status: 'authorized' }), [])).toBe('processing');
  });

  it('error -> error', () => {
    expect(computeEnableBankingStatus(baseEnableBankingConnection({ status: 'error' }), [])).toBe('error');
  });

  it('expired -> expired', () => {
    expect(computeEnableBankingStatus(baseEnableBankingConnection({ status: 'expired' }), [])).toBe('expired');
  });

  it('linked with no accessValidUntil -> error', () => {
    expect(computeEnableBankingStatus(baseEnableBankingConnection({ accessValidUntil: null, status: 'linked' }), [])).toBe('error');
  });

  it('linked with past accessValidUntil -> expired', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    expect(computeEnableBankingStatus(baseEnableBankingConnection({ accessValidUntil: new Date('2026-07-30T12:00:00.000Z'), status: 'linked' }), [])).toBe('expired');
  });

  it('linked with future accessValidUntil but no active accounts -> processing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    expect(computeEnableBankingStatus(baseEnableBankingConnection({ accessValidUntil: new Date('2026-08-30T12:00:00.000Z'), status: 'linked' }), [])).toBe('processing');
  });

  it('linked with future accessValidUntil and all accounts refreshed -> connected', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    const accounts = [baseAccount({ refreshedAt: new Date('2026-07-30T10:00:00.000Z') })];
    expect(computeEnableBankingStatus(baseEnableBankingConnection({ accessValidUntil: new Date('2026-08-30T12:00:00.000Z'), status: 'linked' }), accounts)).toBe('connected');
  });
});

describe('RAD-246 Enable Banking DTO mapping', () => {
  it('maps aspspName onto institutionName and accessValidUntil onto expiresAt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    const accounts = [baseAccount({ refreshedAt: new Date('2026-07-30T10:00:00.000Z') })];
    const connection = baseEnableBankingConnection({
      accessValidUntil: new Date('2026-08-30T12:00:00.000Z'),
      aspspName: 'Real Bank',
      status: 'linked',
    });
    const dto = mapEnableBankingConnection({ ...connection, accounts: { getItems: () => accounts } });
    expect(Object.keys(dto).sort()).toEqual(['accessType', 'dataFreshAsOf', 'expiresAt', 'institutionName', 'provider', 'status']);
    expect(dto.provider).toBe('EnableBanking');
    expect(dto.accessType).toBe('open_banking');
    expect(dto.status).toBe('connected');
    expect(dto.institutionName).toBe('Real Bank');
    expect(dto.expiresAt).toBe(new Date('2026-08-30T12:00:00.000Z').toISOString());
    expect(dto.dataFreshAsOf).toBe(new Date('2026-07-30T10:00:00.000Z').toISOString());
  });

  it('collapses a null/blank aspspName to a null institutionName', () => {
    const dto = mapEnableBankingConnection(baseEnableBankingConnection({ aspspName: null }));
    expect(dto.institutionName).toBeNull();
  });

  it('returns null expiresAt when accessValidUntil is not yet set', () => {
    const dto = mapEnableBankingConnection(baseEnableBankingConnection({ accessValidUntil: null, status: 'created' }));
    expect(dto.expiresAt).toBeNull();
    expect(dto.status).toBe('processing');
  });
});

describe('getBankConnections', () => {
  const buildReq = () => ({ tenant: { tenantKey: 99 }, user: { appuserKey: 1 } }) as unknown as Request;

  const mockFind = (input: { enableBankingConnections?: unknown[]; nordigenRequisitions?: unknown[] }) => {
    mocks.find.mockImplementation((entity: unknown) => {
      if (entity === NordigenRequisition) return Promise.resolve(input.nordigenRequisitions ?? []);
      if (entity === EnableBankingConnection) return Promise.resolve(input.enableBankingConnections ?? []);
      return Promise.resolve([]);
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
  });

  it('returns GoCardless connections unchanged when the user has no Enable Banking connections', async () => {
    const requisition: RequisitionInput = {
      accounts: { getItems: () => [] },
      expiresAt: new Date('2026-08-30T12:00:00.000Z'),
      status: 'linked' as RequisitionInput['status'],
    };
    mockFind({ nordigenRequisitions: [requisition] });
    const json = vi.fn();

    await getBankConnections(buildReq(), { json } as unknown as Response);

    expect(json).toHaveBeenCalledWith({ connections: [mapRequisition(requisition)] });
  });

  it('includes an Enable Banking connection with correctly mapped fields', async () => {
    const connection: EnableBankingInput = {
      accessValidUntil: new Date('2026-08-30T12:00:00.000Z'),
      accounts: { getItems: () => [] },
      aspspName: 'Enable Bank',
      status: 'linked' as EnableBankingInput['status'],
    };
    mockFind({ enableBankingConnections: [connection] });
    const json = vi.fn();

    await getBankConnections(buildReq(), { json } as unknown as Response);

    expect(json).toHaveBeenCalledWith({
      connections: [
        {
          accessType: 'open_banking',
          dataFreshAsOf: null,
          expiresAt: new Date('2026-08-30T12:00:00.000Z').toISOString(),
          institutionName: 'Enable Bank',
          provider: 'EnableBanking',
          status: 'processing',
        },
      ],
    });
  });

  it('returns both provider types together when a user has GoCardless and Enable Banking connections', async () => {
    const requisition: RequisitionInput = {
      accounts: { getItems: () => [] },
      expiresAt: new Date('2026-08-30T12:00:00.000Z'),
      status: 'linked' as RequisitionInput['status'],
    };
    const connection: EnableBankingInput = {
      accessValidUntil: new Date('2026-08-30T12:00:00.000Z'),
      accounts: { getItems: () => [] },
      aspspName: 'Enable Bank',
      status: 'linked' as EnableBankingInput['status'],
    };
    mockFind({ enableBankingConnections: [connection], nordigenRequisitions: [requisition] });
    const json = vi.fn();

    await getBankConnections(buildReq(), { json } as unknown as Response);

    expect(json).toHaveBeenCalledWith({
      connections: [
        expect.objectContaining({ provider: 'GoCardless' }),
        expect.objectContaining({ institutionName: 'Enable Bank', provider: 'EnableBanking' }),
      ],
    });
  });

  it('queries Enable Banking connections scoped to deletedAt: undefined and the caller tenant', async () => {
    mockFind({ enableBankingConnections: [], nordigenRequisitions: [] });
    const json = vi.fn();

    await getBankConnections(buildReq(), { json } as unknown as Response);

    expect(mocks.find).toHaveBeenCalledWith(
      EnableBankingConnection,
      expect.objectContaining({ deletedAt: undefined, tenantKey: { tenantKey: 99 } }),
      expect.anything(),
    );
    expect(json).toHaveBeenCalledWith({ connections: [] });
  });
});
