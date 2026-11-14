/**
 * Expense groups (`/v1/expense-groups`, the API's `expense-group.service.ts`): people who share
 * costs, what each of them owes, and how they settle up.
 *
 * A group has members: people of the household (`isHouseholdMember`, `appuserKey` set) and
 * people with no WonderMoney account, known by name. A cost is shared by splitting one household
 * transaction by person: each person's share is a line of the transaction's split
 * (`TransactionSplitLine.expenseGroupMember`), and the group records who paid. Only the
 * household's own people's shares count in its spending. Paying each other back is a settlement,
 * optionally linked to the transaction that moved the money. Balances are per currency, never
 * converted: positive means the group owes that person, negative that they owe the group.
 */

export interface ExpenseGroupMember {
  expenseGroupMemberKey: number;
  name: string;
  /** Kept for the household's own reference; nothing is ever sent to it. */
  email: string | null;
  /** The household member this person is; null for someone outside the household. */
  appuserKey: number | null;
  /** Whether their shares count in the household's totals. */
  isHouseholdMember: boolean;
  /** Whether this person is the viewer. */
  isYou: boolean;
  position: number;
}

export interface CurrencyAmount {
  currencyCode: string;
  amount: number;
}

export interface ExpenseGroup {
  expenseGroupKey: number;
  name: string;
  /** What new settlements default to; shares are in each transaction's own currency. */
  currencyCode: string;
  archived: boolean;
  /** ISO. */
  createdAt: string;
  members: ExpenseGroupMember[];
  /** The viewer's balance per currency (positive: they are owed); empty when they are not in the group. */
  yourBalances: CurrencyAmount[];
}

export interface MemberBalance {
  memberKey: number;
  paid: number;
  share: number;
  settlementsPaid: number;
  settlementsReceived: number;
  /** Positive: the group owes them; negative: they owe the group. */
  balance: number;
}

export interface SuggestedPayment {
  fromMemberKey: number;
  toMemberKey: number;
  /** Positive. */
  amount: number;
}

export interface CurrencyBalances {
  currencyCode: string;
  members: MemberBalance[];
  /** The payments that would clear every balance in this currency. */
  payments: SuggestedPayment[];
}

export interface GroupBalances {
  expenseGroupKey: number;
  /** Only currencies with something in them, the group's own first. */
  currencies: CurrencyBalances[];
}

/** A household transaction as the group endpoints describe it. */
export interface GroupTransaction {
  transactionKey: number;
  description: string | null;
  merchantName: string | null;
  /** ISO. */
  transactionDate: string | null;
  /** Signed, the user's edit when there is one, in `currencyCode`. */
  settlementAmount: number | null;
  currencyCode: string | null;
  accountKey: number | null;
  accountName: string | null;
}

export type ExpenseGroupSplitMethod = "equal" | "amounts" | "percentages";

export interface GroupExpense {
  expenseGroupExpenseKey: number;
  expenseGroupKey: number;
  /** The category every share is in; null when uncategorized. */
  categoryKey: number | null;
  currencyCode: string | null;
  paidByMemberKey: number;
  splitMethod: ExpenseGroupSplitMethod;
  /** Signed like the transaction (money out negative); they add up to its amount. */
  shares: { expenseGroupMemberKey: number; amount: number }[];
  transaction: GroupTransaction;
}

export interface GroupSettlement {
  expenseGroupSettlementKey: number;
  expenseGroupKey: number;
  fromMemberKey: number;
  toMemberKey: number;
  /** Positive, in `currencyCode`. */
  amount: number;
  currencyCode: string;
  /** `YYYY-MM-DD`. */
  settledOn: string;
  notes: string | null;
  /** Whether the settlement is linked to a transaction, seen or not. */
  isLinked: boolean;
  /** The linked transaction, when the viewer may see it. */
  transaction: GroupTransaction | null;
  /** ISO. */
  createdAt: string;
}

export interface SettlementSuggestion extends GroupTransaction {
  /** What is left to link on it, positive. */
  remainingAmount: number;
}

/** A person to add: someone outside the household by name, or a household member by id. */
export interface ExpenseGroupMemberInput {
  name: string;
  email?: string | null;
  /** The household member's appuserKey; leave out for someone outside the household. */
  householdMemberId?: number | null;
}

export interface CreateExpenseGroupInput {
  name: string;
  currencyCode: string;
  members?: ExpenseGroupMemberInput[];
}

export interface UpdateExpenseGroupInput {
  name?: string;
  currencyCode?: string;
  archived?: boolean;
}

export interface ShareInput {
  memberId: number;
  /** `amounts`: positive, the person's part of the whole. */
  amount?: number;
  /** `percentages`: more than 0, at most 2 decimals; they make 100. */
  percentage?: number;
}

export interface ShareExpenseInput {
  transactionId: number;
  paidByMemberId: number;
  method: ExpenseGroupSplitMethod;
  /** Omitted keeps the transaction's category; null is uncategorized. */
  categoryId?: number | null;
  shares: ShareInput[];
}

export interface RecordSettlementInput {
  fromMemberId: number;
  toMemberId: number;
  /** Positive. */
  amount: number;
  /** `YYYY-MM-DD`. */
  settledOn: string;
  /** The group's currency when left out. */
  currencyCode?: string;
  notes?: string | null;
  transactionId?: number | null;
}
