import { DI } from '@app/database/di';
import { Transaction } from '@entity/Transaction';
import { getEffectiveAppuserAmount } from '@utils/account-amounts';

import { round2, toCsv } from './csv';
import { buildTransactionWhere, type ReportServiceInput, transactionMatchesCategoryKeys } from './report-filters';

export interface SankeyData {
  links: SankeyLink[];
  nodes: SankeyNode[];
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface SankeyNode {
  color?: string;
  id: string;
  kind: 'account' | 'expense' | 'income';
  label: string;
  value?: number;
}

const DEFAULT_INCOME_LIMIT = 8;
const DEFAULT_EXPENSE_LIMIT = 12;
const DEFAULT_ACCOUNT_LIMIT = 8;

const OTHER_INCOME_ID = '__other_income';
const OTHER_EXPENSE_ID = '__other_expense';
const OTHER_ACCOUNT_ID = '__other_account';
const OTHER_LABEL = 'Other';
const UNCATEGORIZED_KEY = 'uncategorized';

interface CategoryBucket {
  color?: string;
  id: string;
  includes: Set<string>;
  label: string;
  value: number;
}

const CATEGORY_POPULATE = [
  'appuserTransactionCategories.categoryKey',
  'appuserTransactionCategories.categoryKey.parentCategory',
  'accountKey',
  'appuserCurrencyKey',
] as const;

export function buildSankeyCsv(data: SankeyData): string {
  const nodesSection = `# nodes\n${stripBom(
    toCsv(
      ['id', 'label', 'kind', 'color', 'value'],
      data.nodes.map((node) => [node.id, node.label, node.kind, node.color ?? '', node.value === undefined ? '' : node.value.toFixed(2)]),
    ),
  )}`;
  const linksSection = `# links\n${stripBom(
    toCsv(
      ['source', 'target', 'value'],
      data.links.map((link) => [link.source, link.target, link.value.toFixed(2)]),
    ),
  )}`;
  return `\uFEFF${nodesSection}\n${linksSection}`;
}

export async function getSankeyReport(input: ReportServiceInput): Promise<SankeyData> {
  const { filters, tenant, user } = input;

  const transactions = await DI.em.find(Transaction, buildTransactionWhere(filters, tenant, user), {
    populate: CATEGORY_POPULATE,
  });

  const categoryKeys = filters.categoryKeys;
  const visible = categoryKeys === undefined ? transactions : transactions.filter((transaction) => transactionMatchesCategoryKeys(transaction, categoryKeys));

  const incomeByCategory = new Map<string, { color?: string; label: string; value: number }>();
  const expenseByCategory = new Map<string, { color?: string; label: string; value: number }>();
  const expenseByCategoryAccount = new Map<string, { accountKey: string; accountLabel: string; categoryKey: string; value: number }>();
  const accountTotals = new Map<string, { label: string; value: number }>();

  for (const transaction of visible) {
    const amount = getEffectiveAppuserAmount(transaction);
    const assignedCategory = transaction.appuserTransactionCategories.getItems()[0]?.categoryKey;
    const categoryKey = assignedCategory ? String(assignedCategory.categoryKey) : null;
    const account = transaction.accountKey;
    const accountKey = account ? String(account.accountKey) : null;

    if (amount > 0) {
      const key = categoryKey ?? UNCATEGORIZED_KEY;
      const current = incomeByCategory.get(key);
      if (current) {
        current.value += amount;
      } else {
        incomeByCategory.set(key, {
          color: assignedCategory?.bgColor,
          label: assignedCategory?.name ?? 'Uncategorized',
          value: amount,
        });
      }
      continue;
    }

    const expenseAmount = Math.abs(amount);
    const key = categoryKey ?? UNCATEGORIZED_KEY;
    const current = expenseByCategory.get(key);
    if (current) {
      current.value += expenseAmount;
    } else {
      expenseByCategory.set(key, {
        color: assignedCategory?.bgColor,
        label: assignedCategory?.name ?? 'Uncategorized',
        value: expenseAmount,
      });
    }

    if (!accountKey) continue;
    const accountLabel = account?.accountName ?? 'Account';
    const pairKey = `${key}|${accountKey}`;
    const pair = expenseByCategoryAccount.get(pairKey);
    if (pair) {
      pair.value += expenseAmount;
    } else {
      expenseByCategoryAccount.set(pairKey, {
        accountKey,
        accountLabel,
        categoryKey: key,
        value: expenseAmount,
      });
    }
    const accountTotal = accountTotals.get(accountKey);
    if (accountTotal) {
      accountTotal.value += expenseAmount;
    } else {
      accountTotals.set(accountKey, { label: accountLabel, value: expenseAmount });
    }
  }

  const incomeBuckets = bucketCategories([...incomeByCategory.entries()], DEFAULT_INCOME_LIMIT, 'income');
  const expenseBuckets = bucketCategories([...expenseByCategory.entries()], DEFAULT_EXPENSE_LIMIT, 'expense');
  const accountBuckets = bucketAccounts([...accountTotals.entries()], DEFAULT_ACCOUNT_LIMIT);

  const nodes: SankeyNode[] = [
    ...incomeBuckets.map((bucket) => ({
      id: bucket.id,
      kind: 'income' as const,
      label: bucket.label,
      ...(bucket.color ? { color: bucket.color } : {}),
      value: round2(bucket.value),
    })),
    ...expenseBuckets.map((bucket) => ({
      id: bucket.id,
      kind: 'expense' as const,
      label: bucket.label,
      ...(bucket.color ? { color: bucket.color } : {}),
      value: round2(bucket.value),
    })),
    ...accountBuckets.map((bucket) => ({
      id: bucket.id,
      kind: 'account' as const,
      label: bucket.label,
      value: round2(bucket.value),
    })),
  ];

  const links: SankeyLink[] = [];

  // income → expense: allocate each expense category across income sources
  // proportionally to the income source's share of total income.
  const totalIncome = incomeBuckets.reduce((sum, bucket) => sum + bucket.value, 0);
  if (totalIncome > 0) {
    for (const incomeBucket of incomeBuckets) {
      for (const expenseBucket of expenseBuckets) {
        const value = round2((expenseBucket.value * incomeBucket.value) / totalIncome);
        if (value <= 0) continue;
        links.push({ source: incomeBucket.id, target: expenseBucket.id, value });
      }
    }
  }

  // expense → account: aggregate the per-(category, account) spend into buckets.
  for (const pair of expenseByCategoryAccount.values()) {
    const expenseBucket = expenseBuckets.find((bucket) => bucket.includes.has(pair.categoryKey));
    const accountBucket = accountBuckets.find((bucket) => bucket.includes.has(pair.accountKey));
    if (!expenseBucket || !accountBucket) continue;
    const existing = links.find((link) => link.source === expenseBucket.id && link.target === accountBucket.id);
    if (existing) {
      existing.value = round2(existing.value + pair.value);
    } else {
      links.push({ source: expenseBucket.id, target: accountBucket.id, value: round2(pair.value) });
    }
  }

  return { links, nodes };
}

function bucketAccounts(entries: [string, { label: string; value: number }][], limit: number): CategoryBucket[] {
  const sorted = entries.sort((a, b) => b[1].value - a[1].value);
  const buckets: CategoryBucket[] = [];
  let overflowValue = 0;
  const overflowKeys = new Set<string>();
  sorted.forEach(([key, info], index) => {
    if (index < limit) {
      buckets.push({ id: `account-${key}`, includes: new Set([key]), label: info.label, value: info.value });
    } else {
      overflowKeys.add(key);
      overflowValue += info.value;
    }
  });
  if (overflowValue > 0) {
    buckets.push({ id: OTHER_ACCOUNT_ID, includes: overflowKeys, label: OTHER_LABEL, value: overflowValue });
  }
  return buckets;
}

function bucketCategories(
  entries: [string, { color?: string; label: string; value: number }][],
  limit: number,
  kind: 'expense' | 'income',
): CategoryBucket[] {
  const sorted = entries.sort((a, b) => b[1].value - a[1].value);
  const buckets: CategoryBucket[] = [];
  let overflowValue = 0;
  const overflowKeys = new Set<string>();
  sorted.forEach(([key, info], index) => {
    if (index < limit) {
      buckets.push({ id: `${kind}-${key}`, includes: new Set([key]), label: info.label, ...(info.color ? { color: info.color } : {}), value: info.value });
    } else {
      overflowKeys.add(key);
      overflowValue += info.value;
    }
  });
  if (overflowValue > 0) {
    buckets.push({ id: kind === 'income' ? OTHER_INCOME_ID : OTHER_EXPENSE_ID, includes: overflowKeys, label: OTHER_LABEL, value: overflowValue });
  }
  return buckets;
}

function stripBom(section: string): string {
  return section.replace(/^\uFEFF/, '');
}
