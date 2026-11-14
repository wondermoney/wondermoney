/**
 * End-to-end proof of the household invite lifecycle against a
 * schema-only disposable DB. Seeds an owner + tenant, then exercises the service:
 * create invite → seat cap → validate (email match/mismatch) → consume (member joins).
 * The seat cap is set to two people here, so one invite fills the household.
 *
 *   createdb wmdb_hh && DB_*=... pnpm migrate:dev
 *   DB_*=... NODE_ENV=development SHOULD_INTERCEPT_EMAILS=true NODE_OPTIONS="--import=tsx" \
 *     node src/database/scripts/verify-household-invite.ts
 */
import { MikroORM } from '@mikro-orm/postgresql';

import config from '@app/mikro-orm.config';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { HouseholdInvite, HouseholdInviteStatus } from '@entity/HouseholdInvite';
import { NordigenRequisition } from '@entity/NordigenRequisition';
import { Tenant } from '@entity/Tenant';
import {
  consumeInvite,
  createHouseholdInvite,
  getHousehold,
  getInviteForValidation,
  revokeHouseholdInvite,
  validateInviteForEmail,
} from '@service/household/household-invite.service';
import { leaveOrRemoveMember, tearDownHouseholdOnOwnerDeletion } from '@service/household/household-membership.service';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`✓ ${message}`);
}

async function expectThrows(fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn();
  } catch {
    console.log(`✓ ${label}`);
    return;
  }
  console.error(`❌ FAIL: expected throw — ${label}`);
  process.exitCode = 1;
  throw new Error(label);
}

async function main() {
  process.env['HOUSEHOLD_MAX_MEMBERS'] = '2';
  const orm = await MikroORM.init(config);
  const em = orm.em.fork();
  const conn = em.getConnection();
  const one = async (sql: string, params: unknown[] = []) => (await conn.execute(sql, params))[0] as Record<string, number>;

  try {
    const cur = (await one(`insert into currency (code, num, decimal_digits, is_active) values ('THH','888',2,true) returning currency_key`))['currency_key']!;
    const ts = (await one(`insert into tenant_status (description) values ('Active') returning tenant_status_key`))['tenant_status_key']!;
    const mkUser = async (email: string, firstName: string, ext: string) =>
      (await one(`insert into appuser (created_at, updated_at, email_address, currency_key, external_user_id, first_name) values (now(),now(),?,?,?,?) returning appuser_key`, [email, cur, ext, firstName]))['appuser_key']!;
    const ownerKey = await mkUser('owner@hh.test', 'hhOwner', 'hhExtOwner');
    await mkUser('existing@hh.test', 'hhExisting', 'hhExtExisting');
    const tenantKey = (await one(`insert into tenant (created_at, updated_at, owner_appuser_key, tenant_status_key) values (now(),now(),?,?) returning tenant_key`, [ownerKey, ts]))['tenant_key']!;
    await conn.execute(`insert into appuser_tenant (created_at, updated_at, appuser_key, tenant_key, role) values (now(),now(),?,?,'owner')`, [ownerKey, tenantKey]);

    const owner = await em.findOneOrFail(Appuser, { appuserKey: ownerKey });
    const tenant = await em.findOneOrFail(Tenant, { tenantKey });

    // 0. An email that already has an account can be invited (they accept from the app); a
    //    member cannot invite at all.
    const existingInvite = await createHouseholdInvite(em, owner, HouseholdRole.OWNER, tenant, 'existing@hh.test');
    assert(existingInvite.status === HouseholdInviteStatus.PENDING, 'an existing account can be invited');
    await revokeHouseholdInvite(em, tenant, HouseholdRole.OWNER, existingInvite.householdInviteKey);
    await expectThrows(() => createHouseholdInvite(em, owner, HouseholdRole.MEMBER, tenant, 'x@hh.test'), 'a member cannot invite');

    // 1. Owner creates an invite.
    const invite = await createHouseholdInvite(em, owner, HouseholdRole.OWNER, tenant, 'Partner@HH.test');
    assert(invite.status === HouseholdInviteStatus.PENDING && invite.emailAddress === 'partner@hh.test', 'invite created (pending, email normalized)');

    // 2. Seat cap: owner (1 membership) + pending invite (1) = full → second invite rejected.
    await expectThrows(() => createHouseholdInvite(em, owner, HouseholdRole.OWNER, tenant, 'other@hh.test'), 'second invite rejected — household full (pending invite consumes the seat)');

    // 3. getHousehold reflects the owner + pending invite.
    const household = await getHousehold(em, tenant, ownerKey);
    assert(household.members.length === 1 && household.members[0]!.role === HouseholdRole.OWNER, 'household shows the owner');
    assert(household.pendingInvite?.email === 'partner@hh.test', 'household shows the pending invite');

    // 4. Validation: wrong email rejected, matching email accepted.
    await expectThrows(() => validateInviteForEmail(em, invite.token, 'someone-else@hh.test'), 'validate rejects an email mismatch');
    await expectThrows(() => validateInviteForEmail(em, 'not-a-real-token', 'partner@hh.test'), 'validate rejects an unknown token');
    const validated = await validateInviteForEmail(em, invite.token, 'partner@hh.test');
    assert(validated.householdInviteKey === invite.householdInviteKey, 'validate accepts the matching email/token');

    // 4b. Public pre-signup validation (the /join page) — token only, no tenant context.
    const preview = await getInviteForValidation(em, invite.token);
    assert(
      preview.email === 'partner@hh.test' && preview.inviterName === 'hhOwner',
      'public validation returns the invited email + inviter name',
    );
    await expectThrows(() => getInviteForValidation(em, 'nope-token'), 'public validation rejects an unknown token');

    // 5. Consume: the invitee signs up, then joins the owner's tenant as a MEMBER; invite marked accepted.
    const memberKey = await mkUser('partner@hh.test', 'hhMember', 'hhExtMember');
    const member = await em.findOneOrFail(Appuser, { appuserKey: memberKey });
    const joinedTenant = await consumeInvite(em, validated, member);
    assert(joinedTenant.tenantKey === tenantKey, 'consume returns the owner tenant');
    em.clear();
    const memberLink = await em.findOneOrFail(AppuserTenant, { appuserKey: { appuserKey: memberKey }, tenantKey: { tenantKey } });
    assert(memberLink.role === HouseholdRole.MEMBER, 'joining person is linked with the invite role (member)');
    const acceptedInvite = await em.findOneOrFail(HouseholdInvite, { householdInviteKey: invite.householdInviteKey });
    assert(acceptedInvite.status === HouseholdInviteStatus.ACCEPTED, 'invite marked accepted');
    await expectThrows(() => getInviteForValidation(em, invite.token), 'public validation rejects an already-accepted invite');

    // 6. Household is now full (owner + member); a further invite is rejected.
    const afterOwner = await em.findOneOrFail(Appuser, { appuserKey: ownerKey });
    const afterTenant = await em.findOneOrFail(Tenant, { tenantKey });
    await expectThrows(() => createHouseholdInvite(em, afterOwner, HouseholdRole.OWNER, afterTenant, 'third@hh.test'), 'no further invites once the household is full');

    // 7. B3 — the member has a bank connection; owner removes them.
    const reqKey = (await one(`insert into nordigen_requisition (created_at, updated_at, requisition_id, status, appuser_key, internal_reference, tenant_key) values (now(),now(),'req-member','linked',?,'ref-member',?) returning nordigen_requisition_key`, [memberKey, tenantKey]))['nordigen_requisition_key']!;
    await expectThrows(() => leaveOrRemoveMember(em, afterTenant, afterOwner, HouseholdRole.OWNER, ownerKey), 'owner cannot be removed via member removal');
    await leaveOrRemoveMember(em, afterTenant, afterOwner, HouseholdRole.OWNER, memberKey, { endSessions: () => Promise.resolve() });
    em.clear();
    const removedLink = await em.findOne(AppuserTenant, { appuserKey: { appuserKey: memberKey }, deletedAt: undefined, recordActive: true, tenantKey: { tenantKey } });
    assert(removedLink === null, 'removed member no longer has an active membership');
    const revokedReq = await em.findOneOrFail(NordigenRequisition, { nordigenRequisitionKey: reqKey });
    assert(revokedReq.deletedAt != null, "removed member's bank connection was revoked");
    const afterRemoval = await getHousehold(em, await em.findOneOrFail(Tenant, { tenantKey }), ownerKey);
    assert(afterRemoval.members.length === 1, 'household shows only the owner after removal');

    // 8. B3 — owner-deletion teardown: re-link the member, then tearing down removes them.
    await em.getRepository(AppuserTenant).createAppuserTenant(
      await em.findOneOrFail(Appuser, { appuserKey: memberKey }),
      await em.findOneOrFail(Tenant, { tenantKey }),
      HouseholdRole.MEMBER,
    );
    await tearDownHouseholdOnOwnerDeletion(em, ownerKey, new Date());
    await em.flush();
    em.clear();
    const afterTeardown = await em.findOne(AppuserTenant, { appuserKey: { appuserKey: memberKey }, deletedAt: undefined, recordActive: true, tenantKey: { tenantKey } });
    assert(afterTeardown === null, 'owner-deletion teardown deactivates the other member');

    console.log('\n✅ household invite + membership lifecycle verified');
  } finally {
    await orm.close(true);
  }
}

await main();
