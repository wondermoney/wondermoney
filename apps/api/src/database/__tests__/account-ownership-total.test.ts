import { describe, expect, it } from 'vitest';

import { addAccount, addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { AccountOwnership } from '@entity/AccountOwnership';
import type { Appuser } from '@entity/Appuser';

/*
 * The database's own guard on ownership shares: an account's rows add up to 10000 basis points, or
 * there are none. It is checked at commit, so a transaction may replace every row before the total
 * is judged, and nothing that skips the service can leave an account half owned.
 */
describe('ownership shares in the database', () => {
  const db = useTestDatabase({ schema: 'migrations' });

  async function household() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const account = await addAccount(em, owner, { balance: 100 });
    return { account, owner, partner };
  }

  const write = (shares: (scenario: Awaited<ReturnType<typeof household>>) => [Appuser, number][], scenario: Awaited<ReturnType<typeof household>>) =>
    db.em().transactional(async (tx) => {
      await tx.nativeDelete(AccountOwnership, { accountKey: scenario.account }, { filters: false });
      for (const [appuser, basisPoints] of shares(scenario)) {
        tx.create(AccountOwnership, { accountKey: scenario.account, appuserKey: appuser, basisPoints, tenantKey: scenario.owner.tenant }, { partial: true });
      }
    });
  const rows = () => db.em().count(AccountOwnership, {}, { filters: false });

  it('accepts shares that add up to the whole, and replacing them within one transaction', async () => {
    const scenario = await household();

    await write(({ owner, partner }) => [[owner.appuser, 6000], [partner, 4000]], scenario);
    await write(({ owner, partner }) => [[owner.appuser, 2500], [partner, 7500]], scenario);

    await expect(rows()).resolves.toBe(2);
  });

  it('refuses shares that do not add up to the whole, at commit', async () => {
    const scenario = await household();

    await expect(write(({ owner, partner }) => [[owner.appuser, 6000], [partner, 3000]], scenario)).rejects.toThrow(/10000/u);
    await expect(rows()).resolves.toBe(0);
  });

  it('refuses removing one holder\'s share and leaving the rest, but not removing them all', async () => {
    const scenario = await household();
    await write(({ owner, partner }) => [[owner.appuser, 5000], [partner, 5000]], scenario);

    await expect(db.em().transactional((tx) => tx.nativeDelete(AccountOwnership, { appuserKey: scenario.partner }, { filters: false }))).rejects.toThrow(/10000/u);
    await expect(rows()).resolves.toBe(2);

    await write(() => [], scenario);
    await expect(rows()).resolves.toBe(0);
  });
});
