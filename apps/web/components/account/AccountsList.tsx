"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Lock,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import {
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import {
  AccountBalance,
  unconvertedAccountCurrencies,
} from "@/components/account/AccountBalance";
import AccountDeleteModal from "@/components/account/AccountDeleteModal";
import AccountEditSheet from "@/components/account/AccountEditSheet";
import { AccountMark } from "@/components/account/AccountMark";
import { AccountRecalculateDialog } from "@/components/account/AccountRecalculateDialog";
import AccountSyncBadge from "@/components/account/AccountSyncBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InspectorDrawer, PropertyList } from "@/components/ui/InspectorDrawer";
import { UnconvertedTotalWarning } from "@/components/ui/UnconvertedTotalWarning";
import { useRouter } from "@/i18n/navigation";
import type { Account } from "@/lib/api/account/useAccounts";
import { useReorderAccounts } from "@/lib/api/account/useAccounts";
import { accountFxView } from "@/lib/fx/fx-status";
import { cn } from "@/lib/utils";
import { CurrencyMismatchError, sumMoney } from "@/lib/utils/money";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import { Amount } from "../ui/Amount";

export default function AccountsList({
  accounts,
  reordering = false,
}: {
  accounts: Account[];
  /** Shows drag handles and up/down buttons instead of the row menu. */
  reordering?: boolean;
}) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency();
  const posthog = usePostHog();
  const router = useRouter();
  const reorderAccounts = useReorderAccounts();

  const [accountData, setAccountData] = useState<{
    name: string | null;
    key: number | null;
    isPrivate: boolean;
    isOwnedByViewer: boolean;
    creditCard: Account["creditCard"];
  }>({
    name: null,
    key: null,
    isPrivate: false,
    isOwnedByViewer: false,
    creditCard: null,
  });
  const [editAccModalIsOpen, setEditAccModalIsOpen] = useState(false);
  const [deleteAccModalIsOpen, setDeleteAccModalIsOpen] = useState(false);
  const [recalculating, setRecalculating] = useState<{
    key: number;
    name: string;
  } | null>(null);
  const closeRecalculate = useCallback(() => setRecalculating(null), []);

  /*
   * The order while reordering. `null` means "whatever the API returned", so entering the mode
   * starts from the saved list. A move is saved immediately and rolled back if the API refuses
   * it (an account added or removed meanwhile).
   */
  const [order, setOrder] = useState<number[] | null>(null);
  // Reset the local order when the mode closes, so reopening starts from the saved list. This is
  // the render-time "adjust state for a changed prop" pattern, not an effect.
  const [wasReordering, setWasReordering] = useState(reordering);
  if (wasReordering !== reordering) {
    setWasReordering(reordering);
    if (!reordering) setOrder(null);
  }

  const orderedAccounts = useMemo(() => {
    if (!reordering) return accounts;
    const keys = order ?? accounts.map((account) => account.accountKey);
    const byKey = new Map(accounts.map((account) => [account.accountKey, account]));
    const placed = keys.flatMap((key) => byKey.get(key) ?? []);
    // An account created since the mode opened has no place yet: it goes last.
    const placedKeys = new Set(placed.map((account) => account.accountKey));
    return [...placed, ...accounts.filter((account) => !placedKeys.has(account.accountKey))];
  }, [accounts, order, reordering]);

  const move = useCallback(
    async (from: number, to: number) => {
      const keys = orderedAccounts.map((account) => account.accountKey);
      if (from === to || to < 0 || to >= keys.length) return;
      const previous = keys;
      const next = arrayMove(keys, from, to);
      setOrder(next);
      try {
        await reorderAccounts.mutateAsync(next);
      } catch {
        setOrder(previous);
        toast.error(t("reorder-accounts-error"));
      }
    },
    [orderedAccounts, reorderAccounts, t],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const keys = orderedAccounts.map((account) => account.accountKey);
    const from = keys.indexOf(Number(active.id));
    const to = keys.indexOf(Number(over.id));
    if (from === -1 || to === -1) return;
    void move(from, to);
  };

  const editAccOpenModal = useCallback(
    (account: Account) => {
      setAccountData({
        name: account.accountName ?? t("unknown"),
        key: account.accountKey,
        isPrivate: account.isPrivate,
        isOwnedByViewer: account.isOwnedByViewer,
        creditCard: account.creditCard ?? null,
      });
      setEditAccModalIsOpen(true);
      posthog.capture("edit_account_modal", { action: "opened" });
    },
    [posthog, t],
  );

  const deleteAccOpenModal = useCallback(
    (account: Account) => {
      setAccountData({
        name: account.accountName ?? t("unknown"),
        key: account.accountKey,
        isPrivate: account.isPrivate,
        isOwnedByViewer: account.isOwnedByViewer,
        creditCard: account.creditCard ?? null,
      });
      setDeleteAccModalIsOpen(true);
      posthog.capture("delete_account_modal", { action: "opened" });
    },
    [posthog, t],
  );

  /*
   * Each balance is in its owner's currency, and household members can keep
   * different ones. The total is in the viewer's currency (the currency of an
   * account they own), and `sumMoney` refuses to add another member's
   * balance in a different currency rather than mixing the two.
   */
  const userCurrency =
    (accounts.find((account) => account.isOwnedByViewer) ?? accounts[0])
      ?.accountOwnerAppuserKey?.currencyKey?.code ?? "EUR";
  const total = totalInCurrency(accounts, userCurrency);
  const totalBalance = total.kind === "total" ? total.amount : null;

  /*
   * § 9 `InspectorDrawer` (D1) — inspect a row without leaving the list.
   *
   * Clicking an account does not push `/accounts/{id}` immediately: that is the
   * pattern the archetype exists to replace, a full navigation to answer "what
   * is the IBAN on this one again?". The drawer answers that in place.
   *
   * Navigation is kept, not removed — unlike transactions, an account has a real
   * detail route with charts and its own transaction list, so the drawer carries
   * a primary action through to it rather than pretending to be it.
   */
  const [inspectedAccount, setInspectedAccount] = useState<Account | null>(
    null,
  );

  const renderRow = (account: Account, index: number, dragHandle?: ReactNode) => {
    const name = account.accountName ?? t("unknown");
    return (
      <div
        key={account.accountKey}
        onClick={
          reordering
            ? undefined
            : () => {
                posthog.capture("accounts_table_row_clicked");
                setInspectedAccount(account);
              }
        }
        className={cn(
          "-mx-2 flex items-center justify-between rounded-md px-2 py-3.5 transition-colors",
          reordering ? "bg-muted/40" : "hover:bg-muted/50 cursor-pointer",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          {dragHandle}
          <AccountMark
            logoUrl={account.accountFinancialInstitutionKey?.logoUrl}
            label={
              account.accountFinancialInstitutionKey?.displayName ??
              account.accountName ??
              t("unknown")
            }
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-foreground text-sm font-medium">{name}</p>
              {account.isPrivate && (
                <Lock
                  className="text-muted-foreground size-3"
                  aria-label={t("account-private")}
                />
              )}
            </div>
            <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
              {!account.isOwnedByViewer && account.ownerFirstName && (
                <span className="flex items-center gap-1">
                  <Users className="h-2.5 w-2.5" />
                  {t("shared-by", { name: account.ownerFirstName })}
                </span>
              )}
              {!account.isOwnedByViewer &&
                account.ownerFirstName &&
                account.accountFinancialInstitutionKey?.displayName && (
                  <span
                    aria-hidden="true"
                    className="bg-border h-3 w-px shrink-0"
                  />
                )}
              {account.accountFinancialInstitutionKey?.displayName && (
                <span className="min-w-0 truncate">
                  {account.accountFinancialInstitutionKey.displayName}
                </span>
              )}
              {account.source === "open_banking" &&
                (account.syncStatus || account.refreshedAt) && (
                  <>
                    {account.accountFinancialInstitutionKey?.displayName && (
                      <span
                        aria-hidden="true"
                        className="bg-border h-3 w-px shrink-0"
                      />
                    )}
                    <AccountSyncBadge
                      syncStatus={account.syncStatus}
                      refreshedAt={account.refreshedAt}
                      className="shrink-0 whitespace-nowrap"
                    />
                  </>
                )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            {/* A balance is a level: not coloured by its sign, and a
                missing one is an em-dash rather than a sentence in the
                column the eye scans. DESIGN.md § 9 rules 1–3. */}
            <AccountBalance
              account={account}
              className="font-mono text-sm font-medium"
            />
            {account.accountOwnerAppuserKey.currencyKey.code !==
              account.currencyKey.code &&
              accountFxView(account).status !== "missing" && (
                <p className="text-muted-foreground font-mono text-xs">
                  <Amount
                    value={account.balance}
                    currency={account.currencyKey.code}
                    className="font-mono text-xs"
                  />
                </p>
              )}
            {account.appuserCurrencyAvailableBalance !== null &&
              account.appuserCurrencyBalance !== null &&
              account.appuserCurrencyAvailableBalance !==
                account.appuserCurrencyBalance && (
                <p className="text-muted-foreground text-xs">
                  {t("available")}:{" "}
                  <span className="font-mono">
                    <Amount
                      value={account.appuserCurrencyAvailableBalance}
                      currency={account.accountOwnerAppuserKey.currencyKey.code}
                    />
                  </span>
                </p>
              )}
          </div>
          {reordering ? (
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 p-0"
                aria-label={t("move-account-up", { name })}
                disabled={index === 0 || reorderAccounts.isPending}
                onClick={() => void move(index, index - 1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 p-0"
                aria-label={t("move-account-down", { name })}
                disabled={
                  index === orderedAccounts.length - 1 ||
                  reorderAccounts.isPending
                }
                onClick={() => void move(index, index + 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
            </div>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="size-8 p-0"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="sr-only">{t("open-menu")}</span>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="flex items-center gap-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    editAccOpenModal(account);
                  }}
                >
                  <Pencil className="size-4" /> {t("edit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex items-center gap-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRecalculating({
                      key: account.accountKey,
                      name: account.accountName ?? t("unknown"),
                    });
                  }}
                >
                  <RefreshCw className="size-4" />{" "}
                  {t("accountRecalculate.menu-item")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive-text flex items-center gap-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteAccOpenModal(account);
                  }}
                >
                  <Trash className="size-4" /> {t("delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {reordering ? (
        <p className="text-muted-foreground mb-3 text-xs">
          {t("reorder-accounts-hint")}
        </p>
      ) : null}
      <div className="divide-border divide-y">
        {reordering ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={orderedAccounts.map((account) => account.accountKey)}
              strategy={verticalListSortingStrategy}
            >
              {orderedAccounts.map((account, index) => (
                <SortableAccountRow
                  key={account.accountKey}
                  id={account.accountKey}
                  label={account.accountName ?? t("unknown")}
                >
                  {(dragHandle) => renderRow(account, index, dragHandle)}
                </SortableAccountRow>
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          orderedAccounts.map((account, index) => renderRow(account, index))
        )}
      </div>
      {/* Total footer */}
      <div className="border-foreground flex items-center justify-between border-t py-3">
        <span className="text-muted-foreground text-sm font-medium">
          {t("total")}
        </span>
        <span className="text-foreground flex items-center gap-2 font-mono text-sm font-semibold">
          {totalBalance !== null
            ? formatCurrency(totalBalance, userCurrency)
            : total.kind === "mixed-currencies"
              ? t("total-balance-mixed-currencies")
              : t("total-balance-incomplete")}
          {/* A balance with no exchange rate is why a total is missing. */}
          {total.kind === "incomplete" ? (
            <UnconvertedTotalWarning
              unconverted={{
                count: 0,
                currencies: unconvertedAccountCurrencies(accounts),
              }}
              currency={userCurrency}
            />
          ) : null}
        </span>
      </div>

      <InspectorDrawer
        open={inspectedAccount !== null}
        onOpenChange={(open) => {
          if (!open) setInspectedAccount(null);
        }}
        objectType={t("account")}
        title={inspectedAccount?.accountName ?? t("unknown")}
        subtitle={
          inspectedAccount?.accountFinancialInstitutionKey?.displayName ??
          undefined
        }
        badges={
          <>
            {inspectedAccount?.isPrivate ? (
              <Badge variant="secondary">{t("private-account")}</Badge>
            ) : null}
            {inspectedAccount &&
            (inspectedAccount.syncStatus || inspectedAccount.refreshedAt) ? (
              <AccountSyncBadge
                syncStatus={inspectedAccount.syncStatus}
                refreshedAt={inspectedAccount.refreshedAt}
              />
            ) : null}
          </>
        }
        actions={
          inspectedAccount ? (
            <Button
              onClick={() => {
                const key = inspectedAccount.accountKey;
                setInspectedAccount(null);
                router.push(`/accounts/${key}`);
              }}
            >
              {t("account-details")}
            </Button>
          ) : null
        }
      >
        {inspectedAccount ? (
          <PropertyList
            items={[
              {
                key: "balance",
                label: t("balance"),
                value: <AccountBalance account={inspectedAccount} />,
              },
              {
                key: "available",
                label: t("available"),
                value: (
                  <Amount
                    value={inspectedAccount.appuserCurrencyAvailableBalance}
                    currency={
                      inspectedAccount.accountOwnerAppuserKey?.currencyKey
                        ?.code ?? userCurrency
                    }
                  />
                ),
              },
            ]}
          />
        ) : null}
      </InspectorDrawer>

      {recalculating && (
        <AccountRecalculateDialog
          accountKey={recalculating.key}
          accountName={recalculating.name}
          onClose={closeRecalculate}
        />
      )}

      {/* Edit / Delete modals */}
      {accountData.name && accountData.key !== null && (
        <>
          <AccountEditSheet
            accountKey={accountData.key}
            accountName={accountData.name}
            isOpen={editAccModalIsOpen}
            isOwnedByViewer={accountData.isOwnedByViewer}
            isPrivate={accountData.isPrivate}
            creditCard={accountData.creditCard}
            onOpenChange={(open) => {
              if (!open) {
                setEditAccModalIsOpen(false);
                setAccountData({
                  name: null,
                  key: null,
                  isPrivate: false,
                  isOwnedByViewer: false,
                  creditCard: null,
                });
                posthog.capture("edit_account_modal", { action: "closed" });
              }
            }}
          />
          <AccountDeleteModal
            isOpen={deleteAccModalIsOpen}
            closeModal={() => {
              setDeleteAccModalIsOpen(false);
              setAccountData({
                name: null,
                key: null,
                isPrivate: false,
                isOwnedByViewer: false,
                creditCard: null,
              });
              posthog.capture("delete_account_modal", { action: "closed" });
            }}
            accountName={accountData.name}
            accountKey={accountData.key.toString()}
          />
        </>
      )}
    </>
  );
}

/**
 * One draggable account row. The handle is the only pointer target, so a row can still be
 * scrolled past; the keyboard sensor gives it Space/arrow reordering without the arrows.
 */
function SortableAccountRow({
  id,
  label,
  children,
}: {
  id: number;
  label: string;
  children: (dragHandle: ReactNode) => ReactNode;
}) {
  const t = useTranslations();
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id });

  const dragHandle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={t("drag-account", { name: label })}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -ml-1 shrink-0 cursor-grab rounded-sm p-1 focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing"
    >
      <GripVertical className="size-4" />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "relative z-10 opacity-80")}
    >
      {children(dragHandle)}
    </div>
  );
}

type AccountsTotal =
  | { amount: number; kind: "total" }
  | { kind: "incomplete" }
  | { kind: "mixed-currencies" };

function totalInCurrency(accounts: Account[], currency: string): AccountsTotal {
  try {
    const amount = sumMoney(
      accounts.map((account) => ({
        amount: account.appuserCurrencyBalance,
        currency: account.accountOwnerAppuserKey.currencyKey.code,
      })),
      currency,
    );
    return amount === null ? { kind: "incomplete" } : { amount, kind: "total" };
  } catch (error) {
    if (error instanceof CurrencyMismatchError) {
      return { kind: "mixed-currencies" };
    }
    throw error;
  }
}
