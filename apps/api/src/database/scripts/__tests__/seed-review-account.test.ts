import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { closeDatabaseMock, connectDatabaseMock, seedMock } = vi.hoisted(() => ({
  closeDatabaseMock: vi.fn().mockResolvedValue(undefined),
  connectDatabaseMock: vi.fn().mockResolvedValue(undefined),
  seedMock: vi.fn(),
}));

vi.mock('@app/database/di', () => ({
  closeDatabase: closeDatabaseMock,
  connectDatabase: connectDatabaseMock,
  DI: { em: {} },
}));

vi.mock('@mikro-orm/core', () => ({ RequestContext: { create: (_em: unknown, run: () => unknown) => run() } }));

vi.mock('@service/review-account/review-account-seed.service', () => ({ seedReviewAccount: seedMock }));

import { main, parseReviewSeedArgs } from '../seed-review-account';

const PASSWORD = 'Zq3-generated_password-for-tests';
const refresh = { budgetUpdated: true, budgetVerified: true, dryRun: false, planned: { bankTransactions: 1, portfolioTransactions: 1 } };

beforeEach(() => {
  seedMock.mockReset();
  connectDatabaseMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the review seeder command line', () => {
  it('refuses to run with neither an --email nor REVIEW_ACCOUNT_EMAIL, before opening the database', async () => {
    expect(() => parseReviewSeedArgs([], {})).toThrow(/address is required/u);
    expect(() => parseReviewSeedArgs([], { REVIEW_ACCOUNT_EMAIL: '  ' })).toThrow(/address is required/u);
    expect(() => parseReviewSeedArgs(['--email'], {})).toThrow(/Usage/u);

    const previous = process.env['REVIEW_ACCOUNT_EMAIL'];
    delete process.env['REVIEW_ACCOUNT_EMAIL'];
    try {
      await expect(main([], () => undefined)).rejects.toThrow(/address is required/u);
    } finally {
      if (previous !== undefined) process.env['REVIEW_ACCOUNT_EMAIL'] = previous;
    }
    expect(connectDatabaseMock).not.toHaveBeenCalled();
    expect(seedMock).not.toHaveBeenCalled();
  });

  it('takes the address from --email, else from the setting, and the optional flags', () => {
    expect(parseReviewSeedArgs(['--email', 'review@example.com'], {})).toMatchObject({
      email: 'review@example.com',
      resetPassword: false,
    });
    expect(parseReviewSeedArgs([], { REVIEW_ACCOUNT_EMAIL: 'review@example.com' }).email).toBe('review@example.com');
    expect(parseReviewSeedArgs(['--', '--email', 'review@example.com'], {}).email).toBe('review@example.com');
    expect(
      parseReviewSeedArgs(['--email', 'flag@example.com'], { REVIEW_ACCOUNT_EMAIL: 'setting@example.com' }).email,
    ).toBe('flag@example.com');
    expect(
      parseReviewSeedArgs(['--reset-password', '--as-of-date', '2026-06-05'], { REVIEW_ACCOUNT_EMAIL: 'review@example.com' }),
    ).toMatchObject({ asOfDate: new Date('2026-06-05T00:00:00.000Z'), resetPassword: true });
    expect(() => parseReviewSeedArgs(['--as-of-date', '2026-02-30'], { REVIEW_ACCOUNT_EMAIL: 'review@example.com' })).toThrow(
      'Invalid --as-of-date value: 2026-02-30',
    );
  });

  it('prints a new password once, on its own line, and nowhere else', async () => {
    seedMock.mockResolvedValue({ appuserKey: 7, authUserCreated: true, password: PASSWORD, refresh, tenantKey: 9 });
    const elsewhere = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
      vi.spyOn(process.stderr, 'write'),
    ];
    const lines: string[] = [];

    await main(['--email', 'review@example.com'], (line) => lines.push(line));

    expect(seedMock).toHaveBeenCalledWith(expect.objectContaining({ email: 'review@example.com', resetPassword: false }));
    expect(lines.filter((line) => line.includes(PASSWORD))).toEqual([PASSWORD]);
    expect(lines[0]).toContain('review@example.com');
    for (const spy of elsewhere) expect(JSON.stringify(spy.mock.calls)).not.toContain(PASSWORD);
  });

  it('prints no password when the run kept the existing one', async () => {
    seedMock.mockResolvedValue({ appuserKey: 7, authUserCreated: false, refresh, tenantKey: 9 });
    const lines: string[] = [];

    await main(['--email', 'review@example.com'], (line) => lines.push(line));

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((line) => /^[\w-]{32}$/u.test(line))).toBe(false);
  });
});
