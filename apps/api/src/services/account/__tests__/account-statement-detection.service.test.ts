import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestStatementMapping } = vi.hoisted(() => ({ requestStatementMapping: vi.fn() }));
vi.mock('@service/account/account-statement-mapping-openai', () => ({ requestStatementMapping }));

import { detectStatement } from '@service/account/account-statement-detection.service';

// Two number columns no name or value tells apart (the second is not a running balance): only the
// model, or the person, can map them.
const UNNAMED = Buffer.from('k1;k2;k3;k4\n2026-01-02;Groceries;-12,40;55,00\n2026-01-03;Salary;2000,00;71,00\n');
const NAMED = Buffer.from('Date;Description;Amount\n2026-01-02;Groceries;-12,40\n');

describe('working out how to read a statement', () => {
  beforeEach(() => {
    requestStatementMapping.mockReset();
  });

  it('maps by column names without spending a model call', async () => {
    const spend = vi.fn().mockResolvedValue(true);

    const detection = await detectStatement({ buffer: NAMED, model: { allowed: true, spend } });

    expect(detection.source).toBe('columns');
    expect(spend).not.toHaveBeenCalled();
  });

  it('asks the model when the names do not settle it, spending one call of the allowance', async () => {
    requestStatementMapping.mockResolvedValue({ columns: { amount: 2, date: 0, description: 1 }, headerRowIndex: 0, spendingIsPositive: false });
    const spend = vi.fn().mockResolvedValue(true);

    const detection = await detectStatement({ buffer: UNNAMED, model: { allowed: true, spend } });

    expect(detection.source).toBe('model');
    expect(detection.applied?.rows.map((row) => row.amount)).toEqual([-12.4, 2000]);
    expect(spend).toHaveBeenCalledTimes(1);
  });

  it('leaves the columns to the person when the allowance is used up', async () => {
    const detection = await detectStatement({ buffer: UNNAMED, model: { allowed: true, spend: vi.fn().mockResolvedValue(false) } });

    expect(detection.source).toBe('none');
    expect(requestStatementMapping).not.toHaveBeenCalled();
  });

  it('leaves the columns to the person when the account may not use AI', async () => {
    const spend = vi.fn().mockResolvedValue(true);

    const detection = await detectStatement({ buffer: UNNAMED, model: { allowed: false, spend } });

    expect(detection.source).toBe('none');
    expect(spend).not.toHaveBeenCalled();
  });

  it('corrects a model answer that the values contradict, keeping its choice of amount over balance', async () => {
    // Date and description swapped, no header row, and the amount offered twice: the values settle all three.
    requestStatementMapping.mockResolvedValue({ columns: { amount: 2, balance: 3, date: 1, debit: 2, description: 0 }, headerRowIndex: -1, spendingIsPositive: false });

    const detection = await detectStatement({ buffer: UNNAMED, model: { allowed: true, spend: vi.fn().mockResolvedValue(true) } });

    expect(detection.source).toBe('model');
    expect(detection.mapping?.columns).toEqual({ amount: 2, balance: 3, date: 0, description: 1 });
    expect(detection.applied?.rows.map((row) => [row.description, row.amount])).toEqual([['Groceries', -12.4], ['Salary', 2000]]);
  });

  it('finds the amount beside the balance the model named, when it put the amount on the wrong column', async () => {
    requestStatementMapping.mockResolvedValue({ columns: { amount: 1, balance: 3, description: 2, reference: 0 }, headerRowIndex: -1, spendingIsPositive: false });

    const detection = await detectStatement({ buffer: UNNAMED, model: { allowed: true, spend: vi.fn().mockResolvedValue(true) } });

    expect(detection.mapping?.columns).toMatchObject({ amount: 2, balance: 3, date: 0, description: 1 });
  });

  it('reads a lone money-in column that holds both signs as the signed amount', async () => {
    requestStatementMapping.mockResolvedValue({ columns: { credit: 2, date: 0, description: 1 }, headerRowIndex: 0, spendingIsPositive: false });

    const detection = await detectStatement({ buffer: UNNAMED, model: { allowed: true, spend: vi.fn().mockResolvedValue(true) } });

    expect(detection.applied?.rows.map((row) => row.amount)).toEqual([-12.4, 2000]);
  });

  it('does not trust a model answer that reads none of the rows', async () => {
    requestStatementMapping.mockResolvedValue({ columns: { amount: 1, date: null, description: 0 }, headerRowIndex: 0, spendingIsPositive: false });
    const unreadable = Buffer.from('k1;k2;k3;k4\nmonday;Groceries;-12,40;987,60\ntuesday;Salary;2000,00;2987,60\n');

    const detection = await detectStatement({ buffer: unreadable, model: { allowed: true, spend: vi.fn().mockResolvedValue(true) } });

    expect(detection.source).toBe('none');
  });
});
