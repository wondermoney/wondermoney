/**
 * RAD-343 (A2) — end-to-end proof that the tenant filter isolates household data.
 *
 * Runs against a SCHEMA-ONLY disposable database (no seeding needed, so it sidesteps
 * RAD-408). It seeds two tenants via raw SQL, then queries through the ORM with the
 * tenant filter engaged and asserts isolation + privacy + nullable-global + system
 * pass-through. Exits non-zero on any failed assertion.
 *
 *   createdb wmdb_a2 && DB_*=... pnpm migrate:dev   # schema only
 *   DB_*=... NODE_ENV=development NODE_OPTIONS="--import=tsx" node src/database/scripts/verify-tenant-filter.ts
 */
import { MikroORM } from '@mikro-orm/postgresql';

import config from '@app/mikro-orm.config';
import { Account } from '@entity/Account';
import { Budget } from '@entity/Budget';
import { Category } from '@entity/Category';
import { Goal } from '@entity/Goal';
import { Portfolio } from '@entity/Portfolio';
import { RecurringSeries } from '@entity/RecurringSeries';
import { Transaction } from '@entity/Transaction';

import { setTenantContext } from '../filters/tenant-filter';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`✓ ${message}`);
}

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

async function main() {
  const orm = await MikroORM.init(config);
  const conn = orm.em.getConnection();
  const one = async (sql: string, params: unknown[] = []) =>
    (await conn.execute(sql, params))[0] as Record<string, number>;

  try {
    const cur = (await one(`insert into currency (code, num, decimal_digits, is_active) values ('TCX','899',2,true) returning currency_key`))['currency_key']!;
    const ts = (await one(`insert into tenant_status (description) values ('Active') returning tenant_status_key`))['tenant_status_key']!;

    const mkUser = async (email: string, ref: string, ext: string) =>
      (await one(`insert into appuser (created_at, updated_at, email_address, referral_code, currency_key, external_user_id) values (now(),now(),?,?,?,?) returning appuser_key`, [email, ref, cur, ext]))['appuser_key']!;
    const userA = await mkUser('a2-a@test', 'a2refA', 'a2extA');
    const userM = await mkUser('a2-m@test', 'a2refM', 'a2extM');
    const userB = await mkUser('a2-b@test', 'a2refB', 'a2extB');

    const mkTenant = async (owner: number) =>
      (await one(`insert into tenant (created_at, updated_at, owner_appuser_key, tenant_status_key) values (now(),now(),?,?) returning tenant_key`, [owner, ts]))['tenant_key']!;
    const tenantA = await mkTenant(userA);
    const tenantB = await mkTenant(userB);

    const link = (appuser: number, tenant: number, role: string) =>
      conn.execute(`insert into appuser_tenant (created_at, updated_at, appuser_key, tenant_key, role) values (now(),now(),?,?,?)`, [appuser, tenant, role]);
    await link(userA, tenantA, 'owner');
    await link(userM, tenantA, 'member');
    await link(userB, tenantB, 'owner');

    const mkAccount = async (tenant: number, owner: number, isPrivate: boolean) =>
      (await one(`insert into account (created_at, updated_at, tenant_key, currency_key, account_owner_appuser_key, is_private) values (now(),now(),?,?,?,?) returning account_key`, [tenant, cur, owner, isPrivate]))['account_key']!;
    const acctShared = await mkAccount(tenantA, userA, false);
    const acctPrivate = await mkAccount(tenantA, userA, true);
    const acctMemberPrivate = await mkAccount(tenantA, userM, true);
    const acctB = await mkAccount(tenantB, userB, false);

    const mkBudget = async (appuser: number, tenant: number) =>
      (await one(`insert into budget (created_at, updated_at, appuser_key, currency_key, tenant_key) values (now(),now(),?,?,?) returning budget_key`, [appuser, cur, tenant]))['budget_key']!;
    const budgetA = await mkBudget(userA, tenantA);
    await mkBudget(userB, tenantB); // budgetB

    const mkCategory = async (name: string, owner: null | number, tenant: null | number, system: boolean) =>
      (await one(`insert into category (created_at, updated_at, name, owner_appuser_key, tenant_key, is_system_category) values (now(),now(),?,?,?,?) returning category_key`, [name, owner, tenant, system]))['category_key']!;
    const catA = await mkCategory('catA', userA, tenantA, false);
    await mkCategory('catB', userB, tenantB, false); // catB (tenant B)
    const catSystem = await mkCategory('catSystem', null, null, true);

    const templateA = (
      await one(
        `insert into budget_template_category
          (created_at, updated_at, budget_key, category_key, amount_budgeted, year, month, recurrency)
         values (now(),now(),?,?,?,?,?,?) returning budget_template_category_key`,
        [budgetA, catA, 100, new Date().getFullYear(), 1, 'MONTHLY'],
      )
    )['budget_template_category_key']!;
    await conn.execute(
      `insert into budget_template_category_accounts
        (budget_template_category_budget_template_category_key, account_account_key)
       values (?, ?), (?, ?), (?, ?)`,
      [templateA, acctShared, templateA, acctPrivate, templateA, acctMemberPrivate],
    );

    const mkGoal = async (appuser: number, tenant: number) =>
      (await one(`insert into goal (created_at, updated_at, appuser_key, name, currency_key, target_amount, tenant_key) values (now(),now(),?,?,?,?,?) returning goal_key`, [appuser, 'goal', cur, 1000, tenant]))['goal_key']!;
    const goalA = await mkGoal(userA, tenantA);
    await mkGoal(userB, tenantB); // goalB (tenant B)

    const mkPortfolio = async (owner: number, tenant: number) =>
      (await one(`insert into portfolio (created_at, updated_at, name, tenant_key, portfolio_owner_appuser_key, currency_key) values (now(),now(),?,?,?,?) returning portfolio_key`, ['pf', tenant, owner, cur]))['portfolio_key']!;
    const portfolioA = await mkPortfolio(userA, tenantA);
    await mkPortfolio(userB, tenantB); // portfolioB (tenant B)

    const mkTransaction = async (account: number, appuser: number, tenant: number) =>
      (await one(`insert into "transaction" (created_at, updated_at, account_key, appuser_key, tenant_key) values (now(),now(),?,?,?) returning transaction_key`, [account, appuser, tenant]))['transaction_key']!;
    const txnShared = await mkTransaction(acctShared, userA, tenantA);
    const txnPrivate = await mkTransaction(acctPrivate, userA, tenantA);
    const txnMemberPrivate = await mkTransaction(acctMemberPrivate, userM, tenantA);
    await mkTransaction(acctB, userB, tenantB); // txnB (tenant B)

    const mkRecurringSeries = async (account: number, tenant: number, name: string) =>
      (await one(`insert into recurring_series (created_at, updated_at, tenant_key, account_key, display_name, normalized_merchant_key) values (now(),now(),?,?,?,?) returning recurring_series_key`, [tenant, account, name, name]))['recurring_series_key']!;
    const rsShared = await mkRecurringSeries(acctShared, tenantA, 'rsShared');
    const rsPrivate = await mkRecurringSeries(acctPrivate, tenantA, 'rsPrivate');

    // 1. SYSTEM context (no tenant set) → pass-through, sees both tenants' budgets.
    {
      const em = orm.em.fork();
      const budgets = await em.find(Budget, {});
      assert(budgets.length === 2, 'system context (no tenant) passes through and sees all budgets');
    }

    // 2. MEMBER of tenant A sees only tenant A's budget.
    {
      const em = orm.em.fork();
      setTenantContext(em, { appuserKey: userM, tenantKey: tenantA });
      const budgets = await em.find(Budget, {});
      assert(
        budgets.length === 1 && budgets[0]!.budgetKey === budgetA,
        'member of tenant A sees only tenant A budgets (tenant B hidden)',
      );
    }

    // 3. Private account hidden from another member, visible to owner.
    {
      const asMember = orm.em.fork();
      setTenantContext(asMember, { appuserKey: userM, tenantKey: tenantA });
      const memberAccts = sorted((await asMember.find(Account, {})).map((a) => a.accountKey));
      assert(
        memberAccts.length === 2 && memberAccts.includes(acctShared) && memberAccts.includes(acctMemberPrivate),
        'member sees the shared account and their own private account, but NOT another owner-private account (or tenant B)',
      );

      const asOwner = orm.em.fork();
      setTenantContext(asOwner, { appuserKey: userA, tenantKey: tenantA });
      const ownerAccts = sorted((await asOwner.find(Account, {})).map((a) => a.accountKey));
      assert(
        ownerAccts.length === 2 && ownerAccts[0] === Math.min(acctShared, acctPrivate) && ownerAccts[1] === Math.max(acctShared, acctPrivate),
        'owner sees their own private account plus the shared one, but not another member private account',
      );

      const memberBudget = await asMember.findOne(Budget, { budgetKey: budgetA }, { populate: ['budgetTemplatesCategory.accounts'] });
      const memberBudgetAccounts = memberBudget?.budgetTemplatesCategory.getItems()[0]?.accounts.getItems() ?? [];
      assert(
        memberBudgetAccounts.length === 2 &&
          memberBudgetAccounts.some((account) => account.accountKey === acctShared) &&
          memberBudgetAccounts.some((account) => account.accountKey === acctMemberPrivate),
        'filtered budget population exposes shared and viewer-owned private accounts only',
      );

      const ownerBudget = await asOwner.findOne(Budget, { budgetKey: budgetA }, { populate: ['budgetTemplatesCategory.accounts'] });
      const ownerBudgetAccounts = ownerBudget?.budgetTemplatesCategory.getItems()[0]?.accounts.getItems() ?? [];
      assert(
        ownerBudgetAccounts.length === 2 &&
          ownerBudgetAccounts.some((account) => account.accountKey === acctShared) &&
          ownerBudgetAccounts.some((account) => account.accountKey === acctPrivate),
        'filtered budget population excludes another member private account for the owner',
      );
    }

    // 4. Categories: tenant A + global system category, not tenant B.
    {
      const em = orm.em.fork();
      setTenantContext(em, { appuserKey: userM, tenantKey: tenantA });
      const cats = sorted((await em.find(Category, {})).map((c) => c.categoryKey));
      assert(
        cats.length === 2 && cats.includes(catA) && cats.includes(catSystem),
        'categories: sees tenant A + NULL-tenant global system category, not tenant B',
      );
    }

    // 5. Goal + Portfolio (simple NOT-NULL tenant scoping) isolate by tenant.
    {
      const em = orm.em.fork();
      setTenantContext(em, { appuserKey: userM, tenantKey: tenantA });
      const goals = (await em.find(Goal, {})).map((g) => g.goalKey);
      const portfolios = (await em.find(Portfolio, {})).map((p) => p.portfolioKey);
      assert(goals.length === 1 && goals[0] === goalA, 'goals isolate by tenant (tenant B goal hidden)');
      assert(
        portfolios.length === 1 && portfolios[0] === portfolioA,
        'portfolios isolate by tenant (tenant B portfolio hidden)',
      );
    }

    // 6. Transaction privacy carve-out via the linked account.
    {
      const asMember = orm.em.fork();
      setTenantContext(asMember, { appuserKey: userM, tenantKey: tenantA });
      const memberTxns = sorted((await asMember.find(Transaction, {})).map((t) => t.transactionKey));
      assert(
        memberTxns.length === 2 && memberTxns.includes(txnShared) && memberTxns.includes(txnMemberPrivate),
        'transactions: member sees shared- and own-private-account txns, NOT another member private txn (or tenant B)',
      );

      const asOwner = orm.em.fork();
      setTenantContext(asOwner, { appuserKey: userA, tenantKey: tenantA });
      const ownerTxns = sorted((await asOwner.find(Transaction, {})).map((t) => t.transactionKey));
      assert(
        ownerTxns.length === 2 && ownerTxns.includes(txnShared) && ownerTxns.includes(txnPrivate),
        'transactions: owner sees shared- and own-private-account txns, NOT another member private txn',
      );
    }

    // 7. RecurringSeries privacy carve-out via the linked account (RAD-343 C1) — the
    // tenant-wide recurring detection must not leak a private account's recurring spend.
    {
      const asMember = orm.em.fork();
      setTenantContext(asMember, { appuserKey: userM, tenantKey: tenantA });
      const memberRs = sorted((await asMember.find(RecurringSeries, {})).map((r) => r.recurringSeriesKey));
      assert(
        memberRs.length === 1 && memberRs[0] === rsShared,
        'recurring series: member sees the shared-account series, NOT the private-account one',
      );

      const asOwner = orm.em.fork();
      setTenantContext(asOwner, { appuserKey: userA, tenantKey: tenantA });
      const ownerRs = sorted((await asOwner.find(RecurringSeries, {})).map((r) => r.recurringSeriesKey));
      assert(
        ownerRs.length === 2 && ownerRs.includes(rsShared) && ownerRs.includes(rsPrivate),
        'recurring series: owner sees both their shared- and private-account series',
      );
    }

    console.log('\n✅ tenant filter isolation verified');
  } finally {
    await orm.close(true);
  }
}

await main();
