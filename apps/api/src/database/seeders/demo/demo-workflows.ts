import type { EntityManager } from '@mikro-orm/core';
import { subDays } from 'date-fns';

import { Account } from '@entity/Account';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';
import { CreditCardDetail } from '@entity/CreditCardDetail';
import { ExpenseGroup } from '@entity/ExpenseGroup';
import { ExpenseGroupExpense, ExpenseGroupSplitMethod } from '@entity/ExpenseGroupExpense';
import { ExpenseGroupMember } from '@entity/ExpenseGroupMember';
import { ExpenseGroupSettlement } from '@entity/ExpenseGroupSettlement';
import type { Goal } from '@entity/Goal';
import { GoalActivity, GoalActivityType } from '@entity/GoalActivity';
import { GoalTransactionFunding } from '@entity/GoalTransactionFunding';
import { Installment } from '@entity/Installment';
import { InstallmentPlan } from '@entity/InstallmentPlan';
import { Rule, RuleMatchMode } from '@entity/Rule';
import { Tag } from '@entity/Tag';
import type { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { TransactionSplit } from '@entity/TransactionSplit';
import { TransactionTag } from '@entity/TransactionTag';
import { buildInstallmentSchedule } from '@service/installment/installment-schedule';

import { demoAccounts, demoCompanion } from './demo-fixtures';
import { upsertDemoRow as upsert } from './demo-upsert';

/** Linked examples for the public read-only demo, never for another household. */
export async function upsertDemoWorkflows(
  em: EntityManager,
  owner: Appuser,
  tenant: Tenant,
  asOf: Date,
  goal: Goal,
): Promise<void> {
  const currency = owner.currencyKey;
  const partner = await ensureCompanion(em, owner, tenant);
  const groceries = await em.findOneOrFail(Category, { isSystemCategory: true, name: 'GROCERIES' });
  const leisure = await em.findOneOrFail(Category, { isSystemCategory: true, name: 'HOBBIES_AND_LEISURE' });
  const dining = await em.findOneOrFail(Category, { isSystemCategory: true, name: 'CAFE_RESTAURANTS_BARS' });
  const tx = (suffix: string) =>
    em.findOneOrFail(Transaction, {
      appuserKey: owner,
      tenantKey: tenant,
      externalTransactionId: `DEMO-BANK-TXN-${suffix}`,
    });

  const tag = await upsert(
    em,
    Tag,
    { tenantKey: tenant, name: 'Family' },
    { tenantKey: tenant, createdByAppuserKey: owner, name: 'Family', color: '#64748b' },
  );
  await em.flush();
  const existingRule = await em.findOne(Rule, { tenantKey: tenant, name: 'Family groceries' });
  const rules = await em.find(Rule, { tenantKey: tenant });
  await upsert(
    em,
    Rule,
    { tenantKey: tenant, name: 'Family groceries' },
    {
      tenantKey: tenant,
      ownerAppuserKey: owner,
      name: 'Family groceries',
      active: true,
      position: existingRule?.position ?? Math.max(-1, ...rules.map((rule) => rule.position)) + 1,
      match: RuleMatchMode.ALL,
      stopProcessing: false,
      version: 1,
      conditions: [{ field: 'merchant', operator: 'contains', value: 'Continente' }],
      actions: [
        { type: 'set_category', categoryId: groceries.categoryKey },
        { type: 'add_tags', tagIds: [tag.tagKey] },
      ],
    },
  );
  await upsert(
    em,
    TransactionTag,
    { tenantKey: tenant, transactionKey: await tx('GROCERIES-CONTINENTE-LARGE'), tagKey: tag },
    { tenantKey: tenant, transactionKey: await tx('GROCERIES-CONTINENTE-LARGE'), tagKey: tag },
  );

  const reserve = {
    tenantKey: tenant,
    appuserKey: owner,
    createdByAppuserKey: owner,
    currencyKey: currency,
    goalKey: goal,
  };
  await upsert(
    em,
    GoalActivity,
    { goalKey: goal, tenantKey: tenant, note: 'Initial emergency buffer' },
    {
      ...reserve,
      type: GoalActivityType.ASSIGNED,
      amount: 2500,
      note: 'Initial emergency buffer',
      occurredAt: subDays(asOf, 60),
    },
  );
  const repair = await tx('LEISURE-WORTEN');
  await upsert(
    em,
    GoalTransactionFunding,
    { tenantKey: tenant, goalKey: goal, transactionKey: repair },
    { tenantKey: tenant, goalKey: goal, transactionKey: repair, currencyKey: currency, amount: 84.9 },
  );
  await upsert(
    em,
    GoalActivity,
    { goalKey: goal, tenantKey: tenant, note: 'Unexpected appliance replacement' },
    {
      ...reserve,
      transactionKey: repair,
      type: GoalActivityType.SPENT_FROM_GOAL,
      amount: 84.9,
      note: 'Unexpected appliance replacement',
      occurredAt: repair.transactionDate ?? asOf,
    },
  );

  const group = await upsert(
    em,
    ExpenseGroup,
    { tenantKey: tenant, name: 'Porto dinner with friends' },
    { tenantKey: tenant, name: 'Porto dinner with friends', currencyKey: currency, createdByAppuserKey: owner },
  );
  const people: ExpenseGroupMember[] = [];
  for (const [position, name, appuserKey] of [
    [0, 'Sofia', owner],
    [1, 'Miguel', partner],
    [2, 'Alex', null],
  ] as const) {
    people.push(
      await upsert(
        em,
        ExpenseGroupMember,
        { expenseGroupKey: group, tenantKey: tenant, name },
        { expenseGroupKey: group, tenantKey: tenant, name, position, appuserKey },
      ),
    );
  }
  const expense = await tx('DINING-RESTAURANTE-CIMA');
  await upsert(
    em,
    ExpenseGroupExpense,
    { tenantKey: tenant, transactionKey: expense },
    {
      tenantKey: tenant,
      transactionKey: expense,
      expenseGroupKey: group,
      paidByMemberKey: people[0],
      splitMethod: ExpenseGroupSplitMethod.EQUAL,
    },
  );
  for (let position = 0; position < people.length; position += 1) {
    await upsert(
      em,
      TransactionSplit,
      { tenantKey: tenant, transactionKey: expense, position },
      {
        tenantKey: tenant,
        transactionKey: expense,
        position,
        amount: -15.1,
        categoryKey: dining,
        expenseGroupMemberKey: people[position],
      },
    );
  }
  const settlement = await tx('GROUP-SETTLEMENT');
  await upsert(
    em,
    ExpenseGroupSettlement,
    { tenantKey: tenant, transactionKey: settlement },
    {
      tenantKey: tenant,
      transactionKey: settlement,
      expenseGroupKey: group,
      fromMemberKey: people[2],
      toMemberKey: people[0],
      currencyKey: currency,
      amount: 10,
      settledOn: (settlement.transactionDate ?? asOf).toISOString().slice(0, 10),
      notes: 'Alex paid back part of dinner',
      recordedByAppuserKey: owner,
    },
  );
  settlement.reviewed = true;

  const card = await em.findOneOrFail(Account, {
    accountId: demoAccounts.card.accountId,
    accountOwnerAppuserKey: owner,
    tenantKey: tenant,
  });
  const cycle = { statementCloseDay: 5, paymentDueDay: 20 };
  await upsert(
    em,
    CreditCardDetail,
    { accountKey: card, tenantKey: tenant },
    { accountKey: card, tenantKey: tenant, ...cycle, creditLimit: 4000, minimumPaymentPercent: 5 },
  );
  const purchaseDate = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 2, 1));
  const plan = await upsert(
    em,
    InstallmentPlan,
    { accountKey: card, tenantKey: tenant, description: 'Family laptop' },
    {
      accountKey: card,
      tenantKey: tenant,
      description: 'Family laptop',
      installmentCount: 6,
      purchaseDate,
      totalAmount: 1200,
      createdByAppuserKey: owner,
      categoryKey: leisure,
    },
  );
  for (const row of buildInstallmentSchedule({ cycle, installmentCount: 6, purchaseDate, totalAmount: 1200 })) {
    await upsert(
      em,
      Installment,
      { installmentPlanKey: plan, installmentNumber: row.installmentNumber, tenantKey: tenant },
      { ...row, installmentPlanKey: plan, tenantKey: tenant },
    );
    if (row.installmentNumber <= 3) {
      const posted = await tx(`CARD-LAPTOP-${3 - row.installmentNumber}`);
      posted.installmentPlanKey = plan;
      posted.installmentNumber = row.installmentNumber;
      posted.reviewed = true;
      await upsert(
        em,
        AppuserTransactionCategory,
        { appuserKey: owner, transactionKey: posted },
        { appuserKey: owner, transactionKey: posted, categoryKey: leisure, source: Source.USER },
      );
    }
  }
}

async function ensureCompanion(em: EntityManager, owner: Appuser, tenant: Tenant): Promise<Appuser> {
  const existing = await em.findOne(Appuser, { emailAddress: demoCompanion.email });
  if (
    existing &&
    (existing.accountType !== AppuserAccountType.DEMO || existing.externalUserId !== demoCompanion.externalUserId)
  )
    throw new Error('The demo companion identity is in use; it was left alone.');
  const partner = await upsert(
    em,
    Appuser,
    { emailAddress: demoCompanion.email },
    {
      emailAddress: demoCompanion.email,
      externalUserId: demoCompanion.externalUserId,
      firstName: demoCompanion.firstName,
      lastName: demoCompanion.lastName,
      accountType: AppuserAccountType.DEMO,
      marketingOptOut: new Date("2024-01-01T00:00:00.000Z"),
      currencyKey: owner.currencyKey,
    },
  );
  const elsewhere = await em.count(AppuserTenant, {
    appuserKey: partner,
    tenantKey: { $ne: tenant },
    recordActive: true,
    deletedAt: null,
  });
  if (elsewhere) throw new Error('The demo companion belongs to another household; it was left alone.');
  await upsert(
    em,
    AppuserTenant,
    { tenantKey: tenant, appuserKey: partner },
    { tenantKey: tenant, appuserKey: partner, role: HouseholdRole.MEMBER, recordActive: true },
  );
  return partner;
}
