"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { toast } from "sonner";

import { LinkedTransactionSummary } from "@/components/account/TransactionReimbursementBadge";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Amount } from "@/components/ui/Amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import DataLoadError from "@/components/ui/DataLoadError";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Link } from "@/components/ui/Link";
import {
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/components/ui/PageSkeleton";
import { useRouter } from "@/i18n/navigation";
import { API_ERROR_CODE, getApiErrorCode } from "@/lib/api/errors";
import type {
  ExpenseGroup,
  GroupSettlement,
} from "@/lib/api/expense-group/types";
import {
  useDeleteExpenseGroup,
  useDeleteSettlement,
  useExpenseGroup,
  useExpenseGroupBalances,
  useExpenseGroupExpenses,
  useExpenseGroupSettlements,
  useUpdateExpenseGroup,
} from "@/lib/api/expense-group/useExpenseGroups";
import {
  balanceStatus,
  memberName,
  paymentPerspective,
} from "@/lib/expense-group/expense-group";
import { useIsHouseholdViewer } from "@/lib/household/useIsHouseholdViewer";
import { parseDateInputValue } from "@/lib/loans/calendar-day";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

import { EditExpenseGroupForm } from "./EditExpenseGroupForm";
import { GroupMembersSection, useMemberLabel } from "./GroupMembersSection";
import {
  RecordSettlementForm,
  type SettlementPrefill,
} from "./RecordSettlementForm";
import { useGroupErrorToast } from "./shared";

function SectionTitle({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <h2 id={id} className="text-base font-semibold">
      {children}
    </h2>
  );
}

/** Each person's balance per currency, and the payments that would clear them. */
function BalancesSection({
  group,
  readOnly,
  onRecord,
}: {
  group: ExpenseGroup;
  readOnly: boolean;
  onRecord: (prefill: SettlementPrefill) => void;
}) {
  const t = useTranslations("expenseGroups.balances");
  const label = useMemberLabel();
  const query = useExpenseGroupBalances(group.expenseGroupKey);
  const currencies = query.data?.currencies ?? [];
  const member = (key: number) =>
    group.members.find((m) => m.expenseGroupMemberKey === key);
  const name = (key: number) => {
    const found = member(key);
    return found ? label(found) : memberName(group.members, key);
  };

  return (
    <section className="space-y-3" aria-labelledby="group-balances">
      <SectionTitle id="group-balances">{t("title")}</SectionTitle>
      {query.isPending ? (
        <TableSkeleton rows={3} columns={2} />
      ) : query.isError ? (
        <DataLoadError onRetry={() => void query.refetch()} />
      ) : currencies.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <Card>
          {currencies.map((currency, index) => (
            <div
              key={currency.currencyCode}
              className={index > 0 ? "border-border border-t" : undefined}
            >
              {currencies.length > 1 ? (
                <p className="text-muted-foreground px-4 pt-3 text-xs">
                  {currency.currencyCode}
                </p>
              ) : null}
              <ul className="divide-border divide-y">
                {currency.members.map((balance) => {
                  const status = balanceStatus(balance.balance);
                  return (
                    <li
                      key={balance.memberKey}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                    >
                      <span className="truncate">
                        {name(balance.memberKey)}
                      </span>
                      <span className="flex shrink-0 items-baseline gap-2">
                        <span className="text-muted-foreground text-xs">
                          {t(status)}
                        </span>
                        {status === "settled" ? null : (
                          <Amount
                            value={Math.abs(balance.balance)}
                            currency={currency.currencyCode}
                            className="font-mono"
                          />
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="bg-muted/40 space-y-2 px-4 py-3">
                <h3 className="text-sm font-medium">{t("payments")}</h3>
                {currency.payments.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {t("payments-empty")}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {currency.payments.map((payment) => {
                      const from = memberName(
                        group.members,
                        payment.fromMemberKey,
                      );
                      const to = memberName(group.members, payment.toMemberKey);
                      return (
                        <li
                          key={`${payment.fromMemberKey}-${payment.toMemberKey}`}
                          className="flex flex-wrap items-center justify-between gap-2 text-sm"
                        >
                          <span>
                            {t(paymentPerspective(payment, group.members), {
                              from,
                              to,
                            })}
                          </span>
                          <span className="flex items-center gap-2">
                            <Amount
                              value={payment.amount}
                              currency={currency.currencyCode}
                              className="font-mono"
                            />
                            {readOnly ? null : (
                              <Button
                                type="button"
                                variant="secondary"
                                size="xs"
                                aria-label={t("record-label", { from, to })}
                                onClick={() =>
                                  onRecord({
                                    fromMemberKey: payment.fromMemberKey,
                                    toMemberKey: payment.toMemberKey,
                                    amount: payment.amount,
                                    currencyCode: currency.currencyCode,
                                  })
                                }
                              >
                                {t("record")}
                              </Button>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

/** The transactions shared in the group: who paid and each person's share. */
function ExpensesSection({ group }: { group: ExpenseGroup }) {
  const t = useTranslations("expenseGroups.expenses");
  const query = useExpenseGroupExpenses(group.expenseGroupKey);
  const expenses = query.data ?? [];

  return (
    <section className="space-y-3" aria-labelledby="group-expenses">
      <SectionTitle id="group-expenses">{t("title")}</SectionTitle>
      {query.isPending ? (
        <TableSkeleton rows={3} columns={2} />
      ) : query.isError ? (
        <DataLoadError onRetry={() => void query.refetch()} />
      ) : expenses.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <Card>
          <ul className="divide-border divide-y">
            {expenses.map((expense) => {
              const currency =
                expense.currencyCode ??
                expense.transaction.currencyCode ??
                group.currencyCode;
              return (
                <li
                  key={expense.expenseGroupExpenseKey}
                  className="space-y-2 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <LinkedTransactionSummary
                      transaction={expense.transaction}
                      extra={t("paid-by", {
                        name: memberName(
                          group.members,
                          expense.paidByMemberKey,
                        ),
                      })}
                    />
                    <Amount
                      value={expense.transaction.settlementAmount}
                      currency={currency}
                      className="shrink-0 font-mono text-sm"
                    />
                  </div>
                  <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {expense.shares.map((share) => (
                      <li key={share.expenseGroupMemberKey}>
                        {memberName(group.members, share.expenseGroupMemberKey)}{" "}
                        <Amount
                          value={Math.abs(share.amount)}
                          currency={currency}
                          className="font-mono"
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}

/** Who paid whom back, with the transaction each is linked to. */
function SettlementsSection({
  group,
  readOnly,
}: {
  group: ExpenseGroup;
  readOnly: boolean;
}) {
  const t = useTranslations("expenseGroups.settlements");
  const tRoot = useTranslations();
  const formatShortDate = useFormatShortDate();
  const notifyError = useGroupErrorToast();
  const query = useExpenseGroupSettlements(group.expenseGroupKey);
  const remove = useDeleteSettlement(group.expenseGroupKey);
  const [removing, setRemoving] = useState<GroupSettlement | null>(null);
  const settlements = query.data ?? [];

  const onDelete = async (settlement: GroupSettlement) => {
    try {
      await remove.mutateAsync(settlement);
    } catch (error) {
      notifyError(error);
      return;
    } finally {
      setRemoving(null);
    }
    toast.success(t("deleted"));
  };

  const names = (settlement: GroupSettlement) => ({
    from: memberName(group.members, settlement.fromMemberKey),
    to: memberName(group.members, settlement.toMemberKey),
  });

  return (
    <section className="space-y-3" aria-labelledby="group-settlements">
      <SectionTitle id="group-settlements">{t("title")}</SectionTitle>
      {query.isPending ? (
        <TableSkeleton rows={2} columns={2} />
      ) : query.isError ? (
        <DataLoadError onRetry={() => void query.refetch()} />
      ) : settlements.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <Card>
          <ul className="divide-border divide-y">
            {settlements.map((settlement) => {
              const settledOn = parseDateInputValue(settlement.settledOn);
              return (
                <li
                  key={settlement.expenseGroupSettlementKey}
                  className="flex items-start justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="min-w-0 space-y-0.5">
                    <span className="block">
                      {t("line", names(settlement))}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {[
                        settledOn ? formatShortDate(settledOn) : null,
                        settlement.notes,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {settlement.isLinked ? (
                      settlement.transaction ? (
                        <span className="text-muted-foreground block text-xs">
                          {t("linked")}
                          {": "}
                          {settlement.transaction.merchantName ??
                            settlement.transaction.description ??
                            "—"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground block text-xs">
                          {t("linked-hidden")}
                        </span>
                      )
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Amount
                      value={settlement.amount}
                      currency={settlement.currencyCode}
                      className="font-mono"
                    />
                    {readOnly ? null : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        aria-label={t("delete-label", names(settlement))}
                        disabled={remove.isPending}
                        onClick={() => setRemoving(settlement)}
                      >
                        {t("delete")}
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removing ? t("delete-label", names(removing)) : null}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tRoot("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (removing) void onDelete(removing);
              }}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/**
 * One group: balances and suggested payments, shared expenses, settlements and people. Writers
 * can record a settlement, edit the group's name and currency, archive and delete it; a
 * household viewer gets none of those actions.
 */
export function ExpenseGroupDetail({ groupId }: { groupId: number }) {
  const t = useTranslations("expenseGroups");
  const tRoot = useTranslations();
  const router = useRouter();
  const posthog = usePostHog();
  const readOnly = useIsHouseholdViewer();
  const notifyError = useGroupErrorToast();
  const query = useExpenseGroup(groupId);
  const update = useUpdateExpenseGroup(groupId);
  const remove = useDeleteExpenseGroup(groupId);
  const [recording, setRecording] = useState<{
    prefill: SettlementPrefill | null;
  } | null>(null);
  const [deleting, setDeleting] = useState<"confirm" | "not-empty" | null>(
    null,
  );
  const [editing, setEditing] = useState(false);

  const back = (
    <Link
      href="/groups"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t("detail.back")}
    </Link>
  );

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeaderSkeleton />
        <TableSkeleton rows={4} columns={2} />
      </div>
    );
  }
  if (query.isError) {
    const notFound = getApiErrorCode(query.error) === API_ERROR_CODE.NOT_FOUND;
    return (
      <div className="flex flex-col gap-4">
        {back}
        {notFound ? (
          <p className="text-muted-foreground text-sm">
            {t("detail.not-found")}
          </p>
        ) : (
          <DataLoadError onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }

  const group = query.data;

  const setArchived = async (archived: boolean) => {
    try {
      await update.mutateAsync({ archived });
    } catch (error) {
      notifyError(error);
      return;
    } finally {
      setDeleting(null);
    }
    posthog.capture("expense_group_archived", { archived });
    toast.success(archived ? t("detail.archived") : t("detail.unarchived"));
  };

  const onDelete = async () => {
    try {
      await remove.mutateAsync();
    } catch (error) {
      if (getApiErrorCode(error) === API_ERROR_CODE.EXPENSE_GROUP_NOT_EMPTY) {
        setDeleting("not-empty");
        return;
      }
      setDeleting(null);
      notifyError(error);
      return;
    }
    posthog.capture("expense_group_deleted");
    toast.success(t("detail.deleted"));
    router.push("/groups");
  };

  const actions = readOnly ? null : (
    <>
      <Button onClick={() => setRecording({ prefill: null })}>
        {t("settlement.action")}
      </Button>
      <Button variant="secondary" onClick={() => setEditing(true)}>
        {t("edit.action")}
      </Button>
      <Button
        variant="secondary"
        loading={update.isPending}
        onClick={() => void setArchived(!group.archived)}
      >
        {group.archived ? t("detail.unarchive") : t("detail.archive")}
      </Button>
      <Button variant="ghost" onClick={() => setDeleting("confirm")}>
        {t("detail.delete")}
      </Button>
    </>
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-3">
        {back}
        <PageHeader
          title={group.name}
          badge={
            group.archived ? (
              <Badge variant="muted" className="font-normal">
                {t("archived-badge")}
              </Badge>
            ) : null
          }
          description={group.archived ? t("detail.archived-notice") : undefined}
          actions={actions}
        />
      </div>

      <BalancesSection
        group={group}
        readOnly={readOnly}
        onRecord={(prefill) => setRecording({ prefill })}
      />
      <ExpensesSection group={group} />
      <SettlementsSection group={group} readOnly={readOnly} />
      <GroupMembersSection group={group} readOnly={readOnly} />

      <DrawerDialog
        open={recording !== null}
        onOpenChange={(open) => {
          if (!open) setRecording(null);
        }}
        title={t("settlement.title")}
        description={t("settlement.description")}
      >
        {recording ? (
          <RecordSettlementForm
            group={group}
            prefill={recording.prefill}
            onDone={() => setRecording(null)}
            onCancel={() => setRecording(null)}
          />
        ) : null}
      </DrawerDialog>

      <DrawerDialog
        open={editing}
        onOpenChange={setEditing}
        title={t("edit.title")}
        description={t("edit.description")}
      >
        {editing ? (
          <EditExpenseGroupForm
            group={group}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        ) : null}
      </DrawerDialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleting === "not-empty"
                ? t("detail.not-empty-title")
                : t("detail.delete-title", { name: group.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting === "not-empty"
                ? t("detail.not-empty-description")
                : t("detail.delete-description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tRoot("cancel")}</AlertDialogCancel>
            {deleting === "not-empty" ? (
              group.archived ? null : (
                <AlertDialogAction
                  onClick={(event) => {
                    event.preventDefault();
                    void setArchived(true);
                  }}
                >
                  {t("detail.archive-instead")}
                </AlertDialogAction>
              )
            ) : (
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void onDelete();
                }}
              >
                {t("detail.delete")}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
