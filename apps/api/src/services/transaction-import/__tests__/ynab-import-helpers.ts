import type { Account } from '@entity/Account';
import type { Enqueue } from '@service/queue/enqueue';

import type { TransactionImportStorage } from '../transaction-import.service';

/** One register line, as YNAB writes it. Amounts are cells in the budget's own number format. */
export interface YnabLine {
  account: string;
  /** `[group, category]`. */
  category?: [string, string];
  date: string;
  inflow?: string;
  memo?: string;
  outflow?: string;
  payee: string;
}

const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** A YNAB register export: the web export's columns, or YNAB 4's. */
export function ynabFile(variant: 'web' | 'ynab4', lines: YnabLine[]): string {
  if (variant === 'web') {
    return [
      ['Account', 'Flag', 'Date', 'Payee', 'Category Group/Category', 'Category Group', 'Category', 'Memo', 'Outflow', 'Inflow', 'Cleared'],
      ...lines.map((line) => [line.account, '', line.date, line.payee, line.category ? `${line.category[0]}: ${line.category[1]}` : '', line.category?.[0] ?? '', line.category?.[1] ?? '', line.memo ?? '', line.outflow ?? '', line.inflow ?? '', 'Cleared']),
    ].map((cells) => cells.map(quote).join(',')).join('\n');
  }
  return [
    ['Account', 'Flag', 'Check Number', 'Date', 'Payee', 'Category', 'Master Category', 'Sub Category', 'Memo', 'Outflow', 'Inflow', 'Cleared', 'Running Balance'],
    ...lines.map((line) => [line.account, '', '', line.date, line.payee, line.category ? `${line.category[0]}: ${line.category[1]}` : '', line.category?.[0] ?? '', line.category?.[1] ?? '', line.memo ?? '', line.outflow ?? '', line.inflow ?? '', 'C', '']),
  ].map((cells) => cells.map(quote).join(',')).join('\n');
}

/** Storage and a queue held in memory: uploads land in a map, and queued jobs are recorded for the test to run. */
export function ynabStorage() {
  const objects = new Map<string, Buffer>();
  const storage: TransactionImportStorage = {
    getAccountCsvBucketName: () => 'csv',
    getObjectBuffer: (_bucket, key) => {
      const object = objects.get(key);
      return object ? Promise.resolve(object) : Promise.reject(new Error('NoSuchKey'));
    },
    getObjectSize: (_bucket, key) => Promise.resolve(objects.get(key)?.length),
    presignAccountUpload: (accountKey) => Promise.resolve({ key: `account-${accountKey}-ynab-upload.csv`, presignedUrl: 'https://files.example.test/upload' }),
  };
  const sent: { data: { correlationId: string; mode: 'commit' | 'parse' }; queue: string }[] = [];
  const enqueue: Enqueue = {
    send: (queue, data) => {
      sent.push({ data: data as (typeof sent)[number]['data'], queue });
      return Promise.resolve(`job-${sent.length}`);
    },
    sendAfter: () => Promise.resolve(null),
  };
  const upload = (account: Account, content: string) => {
    const key = `account-${account.accountKey}-ynab-${objects.size + 1}.csv`;
    objects.set(key, Buffer.from(content, 'utf8'));
    return key;
  };
  return { enqueue, sent, storage, upload };
}
