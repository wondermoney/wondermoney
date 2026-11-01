import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';

import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { getAccountFinancialInstitutions } from '@controller/account/accounts';
import { AccountFinancialInstitution } from '@entity/AccountFinancialInstitution';
import { resolveAccountCsvImportFormat } from '@service/account/account-csv-import-format';

import { AccountFinancialInstitutionSeeder } from '../AccountFinancialInstitutionSeeder';

async function listedInstitutions() {
  let body: { accountFinancialInstitutions: { accountFinancialInstitutionKey: number; displayName: string }[] } | undefined;
  const res = { json: (value: typeof body) => { body = value; return res; } } as unknown as Response;
  await getAccountFinancialInstitutions({} as Request, res);
  return body?.accountFinancialInstitutions ?? [];
}

/*
 * The institution source data lists ActivoBank twice ("Activo Bank" and "Banco ActivoBank"), and
 * only one of them gets the ActivoBank statement import, so the list must offer that one only.
 */
describe('the financial-institution list', () => {
  const db = useTestDatabase();

  it('a fresh instance lists ActivoBank once, and that entry imports the ActivoBank statement', async () => {
    const em = db.em();
    await new AccountFinancialInstitutionSeeder().run(em, {});
    await em.flush();

    const activoBanks = (await listedInstitutions()).filter((institution) => /activo\s*bank/i.test(institution.displayName));
    expect(activoBanks).toHaveLength(1);

    const stored = await db.em().findOneOrFail(AccountFinancialInstitution, { accountFinancialInstitutionKey: activoBanks[0]?.accountFinancialInstitutionKey });
    expect(resolveAccountCsvImportFormat(stored.name)).toMatchObject({ format: 'bank' });
  });

  it('does not offer an institution that has been soft-deleted (merged into another)', async () => {
    const em = db.em();
    em.create(AccountFinancialInstitution, { displayName: 'Banco ActivoBank', id: 'BANCOACTIVOBANK_ACTVPTPL', name: 'Banco ActivoBank' }, { partial: true });
    em.create(AccountFinancialInstitution, { deletedAt: new Date(), displayName: 'Activo Bank', id: 'ACTIVOBANK_BSABESBB', name: 'Activo Bank' }, { partial: true });
    await em.flush();

    expect((await listedInstitutions()).map((institution) => institution.displayName)).toEqual(['Banco ActivoBank']);
  });
});
