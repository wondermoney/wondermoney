import { describe, expect, it } from 'vitest';

import { fetchAccountSet } from '../simplefin-client';
import { mapSimplefinAccountSet, reportedCodeOf } from '../simplefin-mapping';

import { ACCESS_URL, accountSetV1, accountSetV2, fakeSimplefinServer, publicResolver } from './fixtures';

/** Through the real parser, as the provider sees it. */
async function mapped(set: unknown) {
  const server = fakeSimplefinServer({ accounts: () => set });
  return mapSimplefinAccountSet(await fetchAccountSet(ACCESS_URL, {}, { fetch: server.fetch, resolver: publicResolver }));
}

describe('mapSimplefinAccountSet', () => {
  it('maps accounts with SimpleFIN\'s stable ids, the bank as institution and the ISO currency', async () => {
    const result = await mapped(accountSetV1());

    expect(result.accounts.map((entry) => entry.account)).toEqual([
      { currency: 'USD', externalId: 'ACT-CHECKING-1', institutionId: 'simplefin:examplebank.test', name: 'Everyday Checking' },
      { currency: 'USD', externalId: 'ACT-CARD-1', institutionId: 'simplefin:examplebank.test', name: 'Rewards Card' },
    ]);
    expect(result.connectionInstitution).toEqual({ id: 'simplefin:examplebank.test', name: 'Example Bank' });
    expect(result.reportedErrorCode).toBeUndefined();
  });

  it('maps the booked and available balances with the balance date', async () => {
    const [checking, card] = (await mapped(accountSetV1())).accounts;

    expect(checking?.balances).toEqual([
      { balanceAmount: { amount: '1234.56' }, balanceType: 'closingBooked', referenceDate: '2026-11-10T12:00:00.000Z' },
      { balanceAmount: { amount: '1180.25' }, balanceType: 'interimAvailable', referenceDate: '2026-11-10T12:00:00.000Z' },
    ]);
    expect(card?.balances).toEqual([{ balanceAmount: { amount: '-310.00' }, balanceType: 'closingBooked', referenceDate: '2026-11-10T12:00:00.000Z' }]);
  });

  it('files rows by the pending flag, keeps decimal-string amounts in the account currency and SimpleFIN\'s id', async () => {
    const [checking] = (await mapped(accountSetV1())).accounts;

    expect(checking?.transactions.booked).toEqual([
      expect.objectContaining({ bookingDate: '2026-11-08', creditDebitIndicator: 'debit', internalTransactionId: 'simplefin:TRN-1001', providerStatus: 'posted', remittanceInformationUnstructured: 'Corner Grocery', transactionAmount: { amount: '-42.10', currency: 'USD' }, transactionDate: '2026-11-07', transactionId: 'TRN-1001' }),
      expect.objectContaining({ bookingDate: '2026-11-09', creditDebitIndicator: 'credit', debtorName: 'Sample Employer', transactionAmount: { amount: '2500.00', currency: 'USD' }, transactionId: 'TRN-1002' }),
    ]);
    // Pending with `posted: 0`: dated by when it was made.
    expect(checking?.transactions.pending).toEqual([
      expect.objectContaining({ bookingDate: '2026-11-10', creditDebitIndicator: 'debit', providerStatus: 'pending', transactionAmount: { amount: '-15.00', currency: 'USD' }, transactionId: 'TRN-1003' }),
    ]);
  });

  it('accepts numeric amounts and a leading plus sign as decimal strings', async () => {
    const set = accountSetV1({ accounts: [{ balance: 10.5, currency: 'usd', id: 'A', name: 'A', transactions: [{ amount: '+3.50', description: 'Refund', id: 'T', posted: 1_762_000_000 }, { amount: 7, description: 'Gift', id: 'U', posted: 1_762_000_000 }] }] });

    const [account] = (await mapped(set)).accounts;

    expect(account?.account.currency).toBe('USD');
    expect(account?.balances[0]?.balanceAmount?.amount).toBe('10.5');
    expect(account?.transactions.booked?.map((row) => row.transactionAmount)).toEqual([{ amount: '3.50', currency: 'USD' }, { amount: '7', currency: 'USD' }]);
  });

  it('refuses an account in a custom currency and reports it, keeping the others', async () => {
    const result = await mapped(accountSetV2());

    expect(result.accounts.map((entry) => entry.account.externalId)).toEqual(['ACT-A1', 'ACT-B1']);
    expect(result.reportedErrorCode).toBe('unsupported_currency');
  });

  it('names the institution from the version-2 connection, and SimpleFIN itself for several banks', async () => {
    const result = await mapped(accountSetV2());

    expect(result.accounts.map((entry) => [entry.account.institutionId, entry.institutionName])).toEqual([
      ['simplefin:org-scu', 'Sample Credit Union'],
      ['simplefin:org-et', 'Example Trust'],
    ]);
    expect(result.connectionInstitution).toEqual({ id: 'simplefin', name: 'SimpleFIN' });
  });

  it('turns errlist entries into codes for the account, its bank connection or the whole set', async () => {
    const result = await mapped(accountSetV2({
      errlist: [
        { account_id: 'ACT-A1', code: 'act.missingdata', msg: 'Some transactions may be missing' },
        { code: 'con.auth', conn_id: 'CON-B', msg: 'Example Trust needs you to sign in again' },
        { code: 'gen.whatever', msg: 'Something else' },
      ],
    }));

    expect(result.accounts.map((entry) => [entry.account.externalId, entry.reportedErrorCode])).toEqual([
      ['ACT-A1', 'institution_unavailable'],
      ['ACT-B1', 'institution_action_required'],
    ]);
    // Connection-wide: the custom-currency account outranks the unknown general error.
    expect(result.reportedErrorCode).toBe('unsupported_currency');
    expect(JSON.stringify(result)).not.toContain('sign in again');
  });

  it('reads the deprecated errors strings: quota warnings as rate limits, the rest as attention needed', async () => {
    expect((await mapped(accountSetV1({ errors: ['You have exceeded the daily request quota'] }))).reportedErrorCode).toBe('rate_limited');
    expect((await mapped(accountSetV1({ errors: ['Connection to Example Bank may need attention'] }))).reportedErrorCode).toBe('institution_action_required');
  });

  it('ignores holdings', async () => {
    const card = (await mapped(accountSetV1())).accounts.find((entry) => entry.account.externalId === 'ACT-CARD-1');
    expect(JSON.stringify(card)).not.toContain('HLD-1');
  });

  it('skips a row with no date at all instead of guessing one', async () => {
    const set = accountSetV1({ accounts: [{ balance: '1', currency: 'USD', id: 'A', name: 'A', transactions: [{ amount: '-1', description: 'Undated', id: 'T', pending: true, posted: 0 }] }] });
    expect((await mapped(set)).accounts[0]?.transactions).toEqual({ booked: [], pending: [] });
  });
});

describe('reportedCodeOf', () => {
  it.each([
    ['gen.auth', 'authentication'],
    ['con.auth', 'institution_action_required'],
    ['con.', 'institution_action_required'],
    ['act.failed', 'institution_unavailable'],
    ['act.missingdata', 'institution_unavailable'],
    ['gen.api', 'provider_unavailable'],
    ['zzz.unknown', 'provider_unavailable'],
  ])('maps %s to %s', (code, expected) => {
    expect(reportedCodeOf({ code })).toBe(expected);
  });
});
