import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { invalidateTransactionSplits } from "@/lib/api/account/useTransactionSplits";
import { invalidateSpendingTotals } from "@/lib/utils/queryInvalidation";

import api from "../api";
import type {
  CreateExpenseGroupInput,
  ExpenseGroup,
  ExpenseGroupMember,
  ExpenseGroupMemberInput,
  GroupBalances,
  GroupExpense,
  GroupSettlement,
  RecordSettlementInput,
  SettlementSuggestion,
  ShareExpenseInput,
  UpdateExpenseGroupInput,
} from "./types";

/** The domain's query keys: the list, and everything of one group under its own prefix. */
export const expenseGroupKeys = {
  all: ["expense-groups"] as const,
  list: () => ["expense-groups", "list"] as const,
  group: (groupId: number) => ["expense-groups", "detail", groupId] as const,
  balances: (groupId: number) =>
    ["expense-groups", "detail", groupId, "balances"] as const,
  expenses: (groupId: number) =>
    ["expense-groups", "detail", groupId, "shares"] as const,
  expense: (groupId: number, transactionId: number) =>
    ["expense-groups", "detail", groupId, "shares", transactionId] as const,
  settlements: (groupId: number) =>
    ["expense-groups", "detail", groupId, "settlements"] as const,
  suggestions: (groupId: number, params: SettlementSuggestionParams) =>
    ["expense-group-settlement-suggestions", groupId, params] as const,
};

const base = "/v1/expense-groups";

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

export async function getExpenseGroups(
  apiClient: AxiosInstance = api,
): Promise<ExpenseGroup[]> {
  const { data } = await apiClient.get<{ groups: ExpenseGroup[] }>(base);
  return Array.isArray(data?.groups) ? data.groups : [];
}

/** The household's groups, newest first, with their members and the viewer's balances. */
export function useExpenseGroups(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: expenseGroupKeys.list(),
    queryFn: () => getExpenseGroups(),
    enabled: options.enabled ?? true,
  });
}

export async function getExpenseGroup(
  groupId: number,
  apiClient: AxiosInstance = api,
): Promise<ExpenseGroup> {
  const { data } = await apiClient.get<{ group: ExpenseGroup }>(
    `${base}/${groupId}`,
  );
  return data.group;
}

export function useExpenseGroup(
  groupId: number,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: expenseGroupKeys.group(groupId),
    queryFn: () => getExpenseGroup(groupId),
    enabled: options.enabled ?? true,
  });
}

/** Who owes whom per currency, with the payments that would clear it. */
export function useExpenseGroupBalances(groupId: number) {
  return useQuery({
    queryKey: expenseGroupKeys.balances(groupId),
    queryFn: async () => {
      const { data } = await api.get<GroupBalances>(
        `${base}/${groupId}/balances`,
      );
      return {
        ...data,
        currencies: Array.isArray(data?.currencies) ? data.currencies : [],
      };
    },
  });
}

/** The group's shared expenses, the part of them the viewer may see. */
export function useExpenseGroupExpenses(groupId: number) {
  return useQuery({
    queryKey: expenseGroupKeys.expenses(groupId),
    queryFn: async () => {
      const { data } = await api.get<{ expenses: GroupExpense[] }>(
        `${base}/${groupId}/shares`,
      );
      return Array.isArray(data?.expenses) ? data.expenses : [];
    },
  });
}

/** How one transaction is shared in the group: who paid, the method and each share. */
export function useExpenseGroupExpense(
  groupId: number,
  transactionId: number,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: expenseGroupKeys.expense(groupId, transactionId),
    queryFn: async () => {
      const { data } = await api.get<{ expense: GroupExpense }>(
        `${base}/${groupId}/shares/${transactionId}`,
      );
      return data.expense;
    },
    enabled: options.enabled ?? true,
  });
}

/** The group's settlements, newest first. */
export function useExpenseGroupSettlements(groupId: number) {
  return useQuery({
    queryKey: expenseGroupKeys.settlements(groupId),
    queryFn: async () => {
      const { data } = await api.get<{ settlements: GroupSettlement[] }>(
        `${base}/${groupId}/settlements`,
      );
      return Array.isArray(data?.settlements) ? data.settlements : [];
    },
  });
}

export interface SettlementSuggestionParams {
  fromMemberId: number;
  toMemberId: number;
  currencyCode?: string;
  /** Already trimmed and debounced. */
  search?: string;
}

/** The API caps suggestions at 50 and sends 10 by default. */
export const SETTLEMENT_SUGGESTION_LIMIT = 20;

/**
 * Household transactions that could be the money behind a settlement: money in from someone
 * outside the household to a household member, or money out the other way.
 */
export function useSettlementSuggestions(
  groupId: number,
  params: SettlementSuggestionParams,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: expenseGroupKeys.suggestions(groupId, params),
    queryFn: async () => {
      const { data } = await api.get<{ suggestions: SettlementSuggestion[] }>(
        `${base}/${groupId}/settlements/suggestions`,
        {
          params: {
            fromMemberId: params.fromMemberId,
            toMemberId: params.toMemberId,
            currencyCode: params.currencyCode || undefined,
            search: params.search || undefined,
            limit: SETTLEMENT_SUGGESTION_LIMIT,
          },
        },
      );
      return Array.isArray(data?.suggestions) ? data.suggestions : [];
    },
    enabled: options.enabled ?? true,
    // The previous list stays while the next search loads, rather than flashing empty.
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------------------------
// Invalidation
// ---------------------------------------------------------------------------------------------

/** The list (members, your balances) and everything under one group. */
const invalidateGroup = (qc: QueryClient, groupId: number) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: expenseGroupKeys.list() }),
    qc.invalidateQueries({ queryKey: expenseGroupKeys.group(groupId) }),
  ]);

/**
 * Sharing a transaction rewrites its split by person, and only the household's own people's
 * shares count: the transaction lists, category spending, cash flow, budgets and reports are
 * stale, and so is every settlement suggestion list.
 */
const invalidateTotalsFor = async (qc: QueryClient, transactionKey: number) => {
  await Promise.all([
    invalidateTransactionSplits(qc, transactionKey),
    invalidateSpendingTotals(qc),
    qc.invalidateQueries({
      queryKey: ["expense-group-settlement-suggestions"],
    }),
  ]);
};

// ---------------------------------------------------------------------------------------------
// Mutations: each invalidates what it changed before it resolves.
// ---------------------------------------------------------------------------------------------

/** Creates a group; the creator joins as its first member. */
export function useCreateExpenseGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExpenseGroupInput) => {
      const { data } = await api.post<{ group: ExpenseGroup }>(base, input);
      return data.group;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: expenseGroupKeys.list() }),
  });
}

/** Renames, changes the default currency, archives or unarchives a group. */
export function useUpdateExpenseGroup(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateExpenseGroupInput) => {
      const { data } = await api.patch<{ group: ExpenseGroup }>(
        `${base}/${groupId}`,
        input,
      );
      return data.group;
    },
    onSuccess: () => invalidateGroup(qc, groupId),
  });
}

/** Deletes an empty group. Errors: 409 `expense_group_not_empty` (offer archiving). */
export function useDeleteExpenseGroup(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.delete<{ expenseGroupKey: number }>(
        `${base}/${groupId}`,
      );
      return data;
    },
    // The page that deleted it navigates away; only the list is stale.
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: expenseGroupKeys.list() }),
  });
}

/** Adds a person. Errors: 400 `expense_group_member_invalid`. */
export function useAddExpenseGroupMember(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ExpenseGroupMemberInput) => {
      const { data } = await api.post<{ member: ExpenseGroupMember }>(
        `${base}/${groupId}/members`,
        input,
      );
      return data.member;
    },
    onSuccess: () => invalidateGroup(qc, groupId),
  });
}

/** Renames a person or changes their email; whether they are of the household is fixed. */
export function useUpdateExpenseGroupMember(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      memberId,
      ...input
    }: {
      memberId: number;
      name?: string;
      email?: string | null;
    }) => {
      const { data } = await api.patch<{ member: ExpenseGroupMember }>(
        `${base}/${groupId}/members/${memberId}`,
        input,
      );
      return data.member;
    },
    onSuccess: () => invalidateGroup(qc, groupId),
  });
}

/** Removes a person. Errors: 409 `expense_group_member_in_use` (they have shares or settlements). */
export function useRemoveExpenseGroupMember(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: number) => {
      const { data } = await api.delete<{ expenseGroupMemberKey: number }>(
        `${base}/${groupId}/members/${memberId}`,
      );
      return data;
    },
    onSuccess: () => invalidateGroup(qc, groupId),
  });
}

/**
 * Shares a transaction in the group, or changes how it is shared (posting again replaces its
 * shares). Errors: 400 `expense_group_shares_invalid`; 409 `expense_group_transaction_conflict`
 * (a transfer, a loan repayment, a reimbursement link, a settlement, or shared in another group).
 */
export function useShareExpense(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ShareExpenseInput) => {
      const { data } = await api.post<{ expense: GroupExpense }>(
        `${base}/${groupId}/shares`,
        input,
      );
      return data.expense;
    },
    onSuccess: (_expense, input) =>
      Promise.all([
        invalidateGroup(qc, groupId),
        invalidateTotalsFor(qc, input.transactionId),
      ]),
  });
}

/** Stops sharing a transaction: it is whole again, in the shares' category. */
export function useUnshareExpense(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (transactionId: number) => {
      const { data } = await api.delete<{ transactionKey: number }>(
        `${base}/${groupId}/shares/${transactionId}`,
      );
      return data;
    },
    onSuccess: (_data, transactionId) =>
      Promise.all([
        invalidateGroup(qc, groupId),
        invalidateTotalsFor(qc, transactionId),
      ]),
  });
}

/**
 * Records someone paying someone back. A linked transaction stops counting as income or
 * spending. Errors: 400 `expense_group_settlement_invalid`, `expense_group_currency_mismatch`,
 * `expense_group_amount_exceeded`; 409 `expense_group_transaction_conflict`.
 */
export function useRecordSettlement(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordSettlementInput) => {
      const { data } = await api.post<{ settlement: GroupSettlement }>(
        `${base}/${groupId}/settlements`,
        input,
      );
      return data.settlement;
    },
    onSuccess: async (_settlement, input) => {
      await invalidateGroup(qc, groupId);
      if (input.transactionId) {
        await invalidateTotalsFor(qc, input.transactionId);
      }
    },
  });
}

/** Removes a settlement; a linked transaction counts as income or spending again. */
export function useDeleteSettlement(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settlement: GroupSettlement) => {
      const { data } = await api.delete<{ expenseGroupSettlementKey: number }>(
        `${base}/${groupId}/settlements/${settlement.expenseGroupSettlementKey}`,
      );
      return data;
    },
    onSuccess: async (_data, settlement) => {
      await invalidateGroup(qc, groupId);
      if (settlement.isLinked) {
        await invalidateTotalsFor(
          qc,
          settlement.transaction?.transactionKey ?? 0,
        );
      }
    },
  });
}
