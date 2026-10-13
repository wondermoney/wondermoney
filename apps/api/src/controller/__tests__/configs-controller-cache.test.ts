import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
}));

vi.mock('@app/app', () => ({
  DI: { em: { find: mocks.find } },
}));

interface DeferredCall {
  name: StaticName;
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
}

interface StaticResponse {
  accountFinancialInstitutions: { accountFinancialInstitutionKey: number; displayName: string; logoUrl: string }[];
  brokers: { brokerSecret?: string; displayName: string; financialBrokerKey: number; name: string }[];
  currencies: { code: string; currencyKey: number; description: string }[];
  financialTransactionTypes: { financialTransactionTypeKey: number; internalFlag?: boolean; name: string }[];
  transactionTypes: { name: string; transactionTypeKey: number }[];
}

const staticNames = ['TransactionType', 'Currency', 'AccountFinancialInstitution', 'FinancialBroker', 'FinancialTransactionType'] as const;
type StaticName = (typeof staticNames)[number];

const baseCategories = [
  {
    bgColor: '#eee',
    categoryKey: 1,
    childCategory: {
      getItems: () => [{ bgColor: '#ddd', categoryKey: 2, icon: '🥨', isSystemCategory: true, name: 'Snack', textColor: '#222' }],
    },
    defaultHouseholdAmount: 10,
    defaultHouseholdMultiplier: 11,
    defaultIndividualAdultAmount: 12,
    defaultIndividualAdultMultiplier: 13,
    defaultIndividualAmount: 14,
    defaultIndividualDependentAmount: 16,
    defaultIndividualDependentMultiplier: 17,
    defaultIndividualMultiplier: 15,
    icon: '🍔',
    isSystemCategory: false,
    name: 'Food',
    textColor: '#111',
  },
];

function entityName(entity: unknown) {
  return (entity as { name?: string }).name;
}

function makeReq(appuserKey: number) {
  return { user: { appuserKey } } as unknown as Request;
}

function makeRes() {
  return { json: vi.fn() } as unknown as Response;
}

function makeStaticResponse(): StaticResponse {
  return {
    accountFinancialInstitutions: [{ accountFinancialInstitutionKey: 1, displayName: 'Bank', logoUrl: 'x' }],
    brokers: [{ brokerSecret: 'hidden', displayName: 'Broker', financialBrokerKey: 1, name: 'Broker' }],
    currencies: [{ code: 'EUR', currencyKey: 1, description: 'Euro' }],
    financialTransactionTypes: [{ financialTransactionTypeKey: 1, internalFlag: true, name: 'Deposit' }],
    transactionTypes: [{ name: 'Income', transactionTypeKey: 1 }],
  };
}

function staticValues(entity: '' | StaticName) {
  const responses = makeStaticResponse();
  switch (entity) {
    case 'AccountFinancialInstitution':
      return [{ accountFinancialInstitutionKey: 1, createdAt: new Date(), deletedAt: null, displayName: 'Bank', id: 'secret', logoUrl: 'x', name: 'Bank', updatedAt: new Date() }];
    case 'Currency':
      return responses.currencies;
    case 'FinancialBroker':
      return responses.brokers;
    case 'FinancialTransactionType':
      return responses.financialTransactionTypes;
    case 'TransactionType':
      return responses.transactionTypes;
    default:
      return [];
  }
}

describe('getConfigs cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useRealTimers();
  });

  it('fetches each static entity once within ttl and categories per request', async () => {
    const calls: { entity: string; options?: unknown; where?: unknown }[] = [];
    mocks.find.mockImplementation((entity: unknown, where?: unknown, options?: unknown) => {
      const rawName = entityName(entity);
      const name = (rawName ?? '') as '' | StaticName;
      calls.push({ entity: name, options, where });
      if (rawName === 'Category') return Promise.resolve(baseCategories);
      return Promise.resolve(staticValues(name));
    });

    const { getConfigs } = await import('../configs');
    await getConfigs(makeReq(1), makeRes());
    await getConfigs(makeReq(2), makeRes());

    expect(mocks.find).toHaveBeenCalledTimes(7);
    const categoryCalls = calls.filter((call) => call.entity === 'Category');
    // Categories are fetched per request (not cached); tenant/household scoping is now
    // enforced by the global tenant filter rather than a per-request appuserKey $or.
    expect(categoryCalls).toHaveLength(2);
    expect(categoryCalls.every((call) => !Object.hasOwn(call.options ?? {}, 'fields') && !Object.hasOwn(call.options ?? {}, 'disableIdentityMap'))).toBe(true);
    expect(calls.find((call) => call.entity === 'TransactionType')?.options).toMatchObject({ disableIdentityMap: true, fields: ['transactionTypeKey', 'name'], orderBy: { name: 'ASC' } });
    expect(calls.find((call) => call.entity === 'Currency')?.options).toMatchObject({ disableIdentityMap: true, fields: ['currencyKey', 'code', 'description'], orderBy: { code: 'ASC' } });
    expect(calls.find((call) => call.entity === 'AccountFinancialInstitution')?.options).toMatchObject({ disableIdentityMap: true, fields: ['accountFinancialInstitutionKey', 'displayName', 'logoUrl', 'name'], orderBy: { name: 'ASC' } });
    expect(calls.find((call) => call.entity === 'FinancialBroker')?.options).toMatchObject({ disableIdentityMap: true, fields: ['financialBrokerKey', 'name', 'displayName'] });
    expect(calls.find((call) => call.entity === 'FinancialTransactionType')?.options).toMatchObject({ disableIdentityMap: true, fields: ['financialTransactionTypeKey', 'name'] });
  });

  it('fetches static entities again after ttl expiry while categories remain per request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    mocks.find.mockImplementation((entity: unknown) => {
      const rawName = entityName(entity);
      const name = (rawName ?? '') as '' | StaticName;
      return rawName === 'Category' ? Promise.resolve(baseCategories) : Promise.resolve(staticValues(name));
    });
    const { getConfigs } = await import('../configs');
    await getConfigs(makeReq(1), makeRes());
    vi.setSystemTime(new Date('2026-01-01T00:05:01Z'));
    await getConfigs(makeReq(2), makeRes());

    expect(mocks.find.mock.calls.filter(([entity]) => staticNames.includes(entityName(entity) as StaticName))).toHaveLength(10);
    expect(mocks.find.mock.calls.filter(([entity]) => entityName(entity) === 'Category')).toHaveLength(2);
  });

  it('coalesces concurrent cold static loads and both callers resolve', async () => {
    const deferred: DeferredCall[] = [];
    mocks.find.mockImplementation((entity: unknown) => {
      const rawName = entityName(entity);
      const name = (rawName ?? 'TransactionType') as StaticName;
      if (rawName === 'Category') return Promise.resolve(baseCategories);
      return new Promise((resolve, reject) => deferred.push({ name, reject, resolve }));
    });

    const { getConfigs } = await import('../configs');
    const p1 = getConfigs(makeReq(1), makeRes());
    const p2 = getConfigs(makeReq(2), makeRes());

    expect(mocks.find.mock.calls.filter(([entity]) => staticNames.includes(entityName(entity) as StaticName))).toHaveLength(5);
    expect(mocks.find.mock.calls.filter(([entity]) => entityName(entity) === 'Category')).toHaveLength(2);

    deferred.forEach(({ name, resolve }) => {
      resolve(staticValues(name));
    });
    await expect(p1).resolves.toBeUndefined();
    await expect(p2).resolves.toBeUndefined();
  });

  it('clears pending on rejection and retries successfully on later call', async () => {
    let rejectCount = 0;
    mocks.find.mockImplementation((entity: unknown) => {
      const rawName = entityName(entity);
      const name = (rawName ?? '') as '' | StaticName;
      if (rawName === 'Category') return Promise.resolve(baseCategories);
      if (rejectCount === 0) {
        rejectCount += 1;
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve(staticValues(name));
    });

    const { getConfigs } = await import('../configs');
    await expect(Promise.all([getConfigs(makeReq(1), makeRes()), getConfigs(makeReq(2), makeRes())])).rejects.toThrow('boom');
    await expect(getConfigs(makeReq(3), makeRes())).resolves.toBeUndefined();
    expect(mocks.find.mock.calls.filter(([entity]) => staticNames.includes(entityName(entity) as StaticName))).toHaveLength(10);
  });

  it('returns trimmed DTO shapes without unwanted fields', async () => {
    mocks.find.mockImplementation((entity: unknown) => {
      const rawName = entityName(entity);
      const name = (rawName ?? '') as '' | StaticName;
      if (rawName === 'Category') return Promise.resolve(baseCategories);
      return Promise.resolve(staticValues(name));
    });

    const { getConfigs } = await import('../configs');
    const res = makeRes();
    await getConfigs(makeReq(1), res);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

    expect(payload.financialInstitutions[0]).toEqual({ accountFinancialInstitutionKey: 1, displayName: 'Bank', logoUrl: 'x' });
    expect(payload.financialInstitutions[0]).not.toHaveProperty('id');
    expect(payload.financialInstitutions[0]).not.toHaveProperty('name');
    expect(payload.financialInstitutions[0]).not.toHaveProperty('createdAt');
    expect(payload.financialInstitutions[0]).not.toHaveProperty('updatedAt');
    expect(payload.financialInstitutions[0]).not.toHaveProperty('deletedAt');
    expect(payload.currencies[0]).toEqual({ code: 'EUR', currencyKey: 1, description: 'Euro' });
    expect(payload.currencies[0]).not.toHaveProperty('num');
    expect(payload.currencies[0]).not.toHaveProperty('decimalDigits');
    expect(payload.currencies[0]).not.toHaveProperty('isActive');
    expect(payload.categories[0]).toEqual({ bgColor: '#eee', categoryKey: 1, childCategory: [{ bgColor: '#ddd', categoryKey: 2, icon: '🥨', isSystemCategory: true, name: 'Snack', textColor: '#222' }], icon: '🍔', isSystemCategory: false, name: 'Food', textColor: '#111' });
    expect(payload.categories[0]).not.toHaveProperty('defaultHouseholdAmount');
    expect(payload.categories[0]).not.toHaveProperty('defaultHouseholdMultiplier');
    expect(payload.categories[0]).not.toHaveProperty('defaultIndividualAmount');
    expect(payload.brokers[0]).toEqual({ displayName: 'Broker', financialBrokerKey: 1, name: 'Broker' });
    expect(payload.brokers[0]).not.toHaveProperty('brokerSecret');
    expect(payload.financialTransactionTypes[0]).toEqual({ financialTransactionTypeKey: 1, name: 'Deposit' });
    expect(payload.financialTransactionTypes[0]).not.toHaveProperty('internalFlag');
    expect(payload.categories[0].childCategory[0]).not.toHaveProperty('defaultHouseholdAmount');
    expect(payload.categories[0].childCategory[0]).not.toHaveProperty('defaultHouseholdMultiplier');
  });
});
