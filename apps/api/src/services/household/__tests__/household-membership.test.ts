import { describe, expect, it } from 'vitest';

import { addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { HouseholdRole } from '@entity/AppuserTenant';
import { findActiveMembership } from '@service/household/household-membership.service';

/*
 * A long-running job (a statement import) checks the starter's membership more than once with one
 * entity manager. With `refresh`, each check reads the role the database holds now, whatever the
 * entity manager loaded for an earlier one.
 */
describe('findActiveMembership', () => {
  const db = useTestDatabase();

  it('reads the role changed since the entity manager loaded the membership, with refresh', async () => {
    const household = await seedHousehold(db.em());
    const member = await addPartner(db.em(), household);
    const em = DI.em.fork();
    const loaded = await findActiveMembership(em, household.tenant.tenantKey, member.appuserKey);
    expect(loaded?.role).toBe(HouseholdRole.MEMBER);

    await em.getConnection().execute('update appuser_tenant set role = ? where appuser_key = ? and tenant_key = ?', [HouseholdRole.VIEWER, member.appuserKey, household.tenant.tenantKey]);

    const again = await findActiveMembership(em, household.tenant.tenantKey, member.appuserKey, { refresh: true });
    expect(again?.role).toBe(HouseholdRole.VIEWER);
  });

});
