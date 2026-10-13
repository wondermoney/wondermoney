import { readFileSync } from 'fs';
import { resolve } from 'path';

import { describe, expect, it, vi } from 'vitest';

import { authedTenant } from '@middleware/stacks';

const routeModuleMocks = vi.hoisted(() => ({
  account: {
    confirmTransactionOCRImportAndCreateTransaction: vi.fn(),
    createOfflineAccount: vi.fn(),
    createTransaction: vi.fn(),
    createTransactionOCRImport: vi.fn(),
    deleteAccount: vi.fn(),
    getAccount: vi.fn(),
    getAccountFinancialInstitutions: vi.fn(),
    getAccountMetrics: vi.fn(),
    getAccounts: vi.fn(),
    getAccountsCashflow: vi.fn(),
    getAccountsMetrics: vi.fn(),
    getAccountTransactions: vi.fn(),
    getAccountTypes: vi.fn(),
    getCategorySpending: vi.fn(),
    getCurrencies: vi.fn(),
    getRecentTransactions: vi.fn(),
    getS3PresignedUrlForCsvUpload: vi.fn(),
    getTransactionHistory: vi.fn(),
    getTransactionMerchants: vi.fn(),
    getTransactions: vi.fn(),
    getTransactionTypes: vi.fn(),
    rejectTransactionOCRImport: vi.fn(),
    startAccountCsvImport: vi.fn(),
    updateAccount: vi.fn(),
    updateTransaction: vi.fn(),
    updateTransactions: vi.fn(),
  },
  banking: {
    getBankAccounts: vi.fn(),
    getBankList: vi.fn(),
    getBankSyncStatus: vi.fn(),
    startBankConnection: vi.fn(),
    unlinkRequisition: vi.fn(),
  },
  bankingConnections: {
    getBankConnections: vi.fn(),
  },
  recurring: {
    confirmRecurringSeries: vi.fn(),
    detectRecurring: vi.fn(),
    dismissRecurringSeries: vi.fn(),
    getRecurringItems: vi.fn(),
    getRecurringSummary: vi.fn(),
    updateRecurringSeries: vi.fn(),
  },
}));

vi.mock('@controller/banking', () => routeModuleMocks.banking);
vi.mock('@controller/banking-connections', () => routeModuleMocks.bankingConnections);
vi.mock('@controller/account', () => routeModuleMocks.account);
vi.mock('@controller/recurring', () => routeModuleMocks.recurring);

import bankingRouter from '../banking';

const GUARDED_MOUNTS = [
  '/v1/account',
  '/v1/assistant',
  '/v1/banking',
  '/v1/budget',
  '/v1/category',
  '/v1/configs',
  '/v1/financial-markets',
  '/v1/goals',
  '/v1/loan',
  '/v1/net-worth',
  '/v1/portfolio',
  '/v1/recurring',
  '/v1/user',
];

/**
 * Return just the argument list of `this.host.use('<mount>', ...)`, so the ordering assertions
 * below are scoped to one mount instead of matching anywhere later in the file. Every mount
 * call ends at the first `);` — the middleware factories in the list are written `fn(),`.
 */
function extractMountArguments(appSource: string, mount: string): string {
  const start = appSource.search(new RegExp(`this\\.host\\.use\\(\\s*['"]${mount}['"]`));
  expect(start, `no mount found for ${mount}`).toBeGreaterThan(-1);
  const end = appSource.indexOf(');', start);
  expect(end, `unterminated mount for ${mount}`).toBeGreaterThan(start);
  return appSource.slice(start, end);
}

describe('demo guard route coverage', () => {
  // RAD-audit: these assertions used to read `app.ts` off disk and search its SOURCE TEXT for
  // middleware names in order — making the file's formatting a public contract. They broke
  // the moment the fourteen copy-pasted middleware arrays were collapsed into the named
  // `authedTenant` stack, despite behaviour being identical.
  //
  // The stacks are now the single definition every guarded mount spreads, so asserting their
  // composition asserts every mount by construction. The source check that remains is
  // deliberately weak and stable: that each guarded mount spreads a stack rather than
  // hand-rolling its own chain.

  it('composes the auth/tenant/demo chain in the required order', () => {
    // Rate limiting (RAD-547) sits between `requireAuth` and `getUser`: it keys on the
    // verified Supabase subject, and running it before the user lookup sheds load earlier.
    const stack = authedTenant();
    const names = stack.map((middleware) => middleware.name);
    expect(names[0]).toBe('requireAuth');
    // `express-rate-limit` returns an anonymous function, so assert by position: exactly one
    // middleware sits between `requireAuth` and `getUser`, and it is the limiter.
    expect(stack).toHaveLength(6);
    expect(typeof stack[1]).toBe('function');
    expect(names.slice(2)).toEqual(['getUser', 'resolveTenantForRequest', 'assertTenantResolved', 'blockDemoMutation']);
  });

  it('spreads a named stack on every guarded mount rather than hand-rolling one', () => {
    const appSource = readFileSync(resolve(__dirname, '../../../app.ts'), 'utf-8');

    for (const mount of GUARDED_MOUNTS) {
      const args = extractMountArguments(appSource, mount);
      expect(args, `${mount} does not use a named middleware stack`).toMatch(/\.\.\.authedTenant\(/);
    }
  });

  // Banking route ordering is asserted behaviourally in `route-order.test.ts` (it issues the
  // request and checks which handler received it) rather than by pinning `router.stack`.

  it('keeps demo middleware on banking state-change routes', () => {
    const routes = bankingRouter.stack.filter(
      (layer: { route?: { path?: string; stack?: { handle?: unknown }[] } }) => layer.route,
    );
    const middlewareByPath = new Map(
      routes.map((layer: { route?: { path?: string; stack?: { handle?: unknown }[] } }) => [
        layer.route?.path,
        layer.route?.stack?.map((step) => step.handle),
      ]),
    );

    expect(middlewareByPath.get('/bank/:bankId/start')).toHaveLength(2);
    expect(middlewareByPath.get('/requisition/:requisitionId')).toHaveLength(1);
  });

  it('retains auth callback without demo mutation middleware', () => {
    const authRoutesSource = readFileSync(resolve(__dirname, '../auth.ts'), 'utf-8');
    expect(authRoutesSource).not.toContain('blockDemoMutation');
  });
});
