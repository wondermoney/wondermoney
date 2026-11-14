import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, addPartner, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Account } from '@entity/Account';
import { CreditCardDetail } from '@entity/CreditCardDetail';
import accountRoutes from '@route/account';

/*
 * A card's statements and the transactions in them follow the account: a household member reads
 * them for a shared card, but the other member's private card, like another household's, does not
 * exist for them, list or detail.
 */
describe('credit card statements over HTTP', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/account', accountRoutes);

  async function household() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const asCard = (account: Account) => em.create(CreditCardDetail, { accountKey: account, paymentDueDay: 10, statementCloseDay: 31, tenantKey: owner.tenant }, { partial: true });
    const privateCard = await addAccount(em, owner, { isPrivate: true, name: 'Owner private card' });
    asCard(owner.account);
    asCard(privateCard);
    await em.flush();
    await addTransaction(em, owner, { account: privateCard, amount: -75, date: new Date('2026-01-05T12:00:00.000Z'), status: 'BOOKED' });
    const neighbour = await seedHousehold(em);
    return { neighbour, owner, partner, privateCard };
  }

  const list = (account: Account) => `/v1/account/${account.accountKey}/statements?from=2026-01-01&to=2026-01-31`;
  const detail = (account: Account) => `/v1/account/${account.accountKey}/statements/2026-01-31`;

  it('lets the partner read a shared card’s statements', async () => {
    const { owner, partner } = await household();

    const statements = await http.as(partner).get(list(owner.account));
    const statement = await http.as(partner).get(detail(owner.account));

    expect(statements.status).toBe(200);
    expect(statement.status).toBe(200);
  });

  it('shows the owner their private card’s statement and its transactions', async () => {
    const { owner, privateCard } = await household();

    const response = await http.as(owner.appuser).get(detail(privateCard));

    expect(response.status).toBe(200);
    expect(response.body.statement).toMatchObject({ charges: 75, periodEnd: '2026-01-31' });
    expect(response.body.statement.transactions).toHaveLength(1);
  });

  it('does not find the other member’s private card, nor another household’s', async () => {
    const { neighbour, owner, partner, privateCard } = await household();

    const responses = await Promise.all([
      http.as(partner).get(list(privateCard)),
      http.as(partner).get(detail(privateCard)),
      http.as(neighbour.appuser).get(list(owner.account)),
      http.as(neighbour.appuser).get(detail(owner.account)),
    ]);

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
  });
});
