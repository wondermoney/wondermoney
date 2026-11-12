/** One line of an Actual Budget transactions export. `notes` carries Actual's split markers as it writes them. */
export interface ActualLine {
  account: string;
  /** Actual writes a plain signed number (`-12.5`); a split parent's is 0. */
  amount: string;
  category?: string;
  date: string;
  notes?: string;
  payee: string;
  /** A split parent's total; 0 on every other row. */
  splitAmount?: string;
}

const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** An Actual Budget transactions export, with the columns Actual writes. */
export function actualFile(lines: ActualLine[]): string {
  return [
    ['Account', 'Date', 'Payee', 'Notes', 'Category', 'Amount', 'Split_Amount', 'Cleared'],
    ...lines.map((line) => [line.account, line.date, line.payee, line.notes ?? '', line.category ?? '', line.amount, line.splitAmount ?? '0', 'Cleared']),
  ].map((cells) => cells.map(cell).join(',')).join('\n');
}

/** Checking and Savings with a transfer between them (its payee the other account, as Actual names it), a split, and four categories. */
export const actualBudget = (): string =>
  actualFile([
    { account: 'Checking', amount: '-400', date: '2026-02-03', notes: 'Monthly saving', payee: 'Savings' },
    { account: 'Checking', amount: '1500', category: 'Income', date: '2026-01-31', notes: 'January salary', payee: 'Example Employer' },
    { account: 'Checking', amount: '-1234.56', category: 'Electricity', date: '2026-01-25', payee: 'City Power' },
    { account: 'Checking', amount: '0', date: '2026-01-20', notes: '(SPLIT INTO 2) Weekly shop', payee: 'Corner Market', splitAmount: '-62.5' },
    { account: 'Checking', amount: '-50', category: 'Groceries', date: '2026-01-20', notes: '(SPLIT 1 OF 2) ', payee: 'Corner Market' },
    { account: 'Checking', amount: '-12.5', category: 'Household', date: '2026-01-20', notes: '(SPLIT 2 OF 2) Batteries', payee: 'Corner Market' },
    { account: 'Checking', amount: '-42.5', category: 'Groceries', date: '2026-01-15', payee: 'Corner Grocer' },
    { account: 'Savings', amount: '400', date: '2026-02-03', notes: 'Monthly saving', payee: 'Checking' },
    { account: 'Savings', amount: '2000', category: 'Starting Balances', date: '2026-01-01', payee: 'Starting Balance' },
  ]);
