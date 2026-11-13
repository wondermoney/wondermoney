"use client";

import {
  CheckCircle2,
  Clock,
  Link2,
  Link2Off,
  Pencil,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
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
import { ObjectHeader } from "@/components/ui/ObjectHeader";
import { Section } from "@/components/ui/RuledSection";
import { StatCard, StatCardGrid } from "@/components/ui/StatCard";
import type { Category } from "@/lib/api/category/useCategories";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import type {
  Installment,
  InstallmentPlanDetail as InstallmentPlanDetailData,
  InstallmentStatus,
} from "@/lib/api/installment-plans/types";
import {
  installmentLinkError,
  useDeleteInstallmentPlan,
  useUnlinkInstallment,
} from "@/lib/api/installment-plans/useInstallmentPlanMutations";
import { cn } from "@/lib/utils";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import InstallmentLinkDialog from "./InstallmentLinkDialog";
import InstallmentPlanFormDialog from "./InstallmentPlanFormDialog";
import { useFormatPlanDay } from "./useFormatPlanDay";

const STATUS_VARIANT: Record<
  InstallmentStatus,
  "success" | "outline" | "warning"
> = {
  paid: "success",
  upcoming: "outline",
  unmatched: "warning",
};

/**
 * One installment plan: what it costs, what is paid and what is still to come, and its
 * schedule. Paid rows show what the card posted; upcoming rows are projections, drawn like the
 * forecast's projected rows (dashed, muted) because they are not transactions.
 */
export default function InstallmentPlanDetail({
  plan,
  categories,
  onDeleted,
}: {
  plan: InstallmentPlanDetailData;
  categories: Category[];
  onDeleted?: () => void;
}) {
  const t = useTranslations();
  const formatPlanDay = useFormatPlanDay();
  const deletePlan = useDeleteInstallmentPlan();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const unlink = useUnlinkInstallment();
  const [linkTarget, setLinkTarget] = useState<Installment | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<Installment | null>(null);

  const onDelete = async () => {
    try {
      await deletePlan.mutateAsync(plan.installmentPlanKey);
      toast.success(t("installments.deleted"));
      setDeleteOpen(false);
      onDeleted?.();
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
          duration: 9000,
        });
        return;
      }
      toast.error(t("installments.delete-failed"), { duration: 9000 });
    }
  };

  const onUnlink = async () => {
    if (!unlinkTarget) return;
    try {
      await unlink.mutateAsync({
        installmentPlanKey: plan.installmentPlanKey,
        installmentNumber: unlinkTarget.installmentNumber,
      });
      toast.success(t("installments.unlinked"));
      setUnlinkTarget(null);
    } catch (error) {
      const reason = installmentLinkError(error);
      if (reason === "demo") {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
          duration: 9000,
        });
        return;
      }
      toast.error(
        t(
          reason === "not-found"
            ? "installments.link-errors.not-found"
            : "installments.link-errors.unlink-failed",
        ),
        { duration: 9000 },
      );
    }
  };

  return (
    <div className="flex flex-col gap-10 lg:gap-12">
      <ObjectHeader
        backHref={`/accounts/${plan.accountKey}`}
        backLabel={plan.accountName}
        title={plan.description}
        subtitle={t("installments.purchased-on", {
          date: formatPlanDay(plan.purchaseDate, { alwaysShowYear: true }),
        })}
        value={plan.totalAmount}
        currency={plan.currency}
        valueLabel={t("installments.total")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" aria-hidden="true" />
              {t("installments.edit")}
            </Button>
            <Button variant="ghost" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="size-4" aria-hidden="true" />
              {t("installments.delete")}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <StatCardGrid>
          <StatCard
            icon={CheckCircle2}
            label={t("installments.paid")}
            value={plan.paidAmount}
            currency={plan.currency}
            helper={t("installments.count-of", { count: plan.paidCount })}
          />
          <StatCard
            icon={Clock}
            label={t("installments.remaining")}
            value={plan.remainingAmount}
            currency={plan.currency}
            helper={t("installments.count-of", { count: plan.remainingCount })}
          />
          <StatCard
            label={t("installments.next-installment")}
            value={plan.nextInstallment?.amount ?? null}
            currency={plan.currency}
            helper={
              plan.nextInstallment
                ? `${formatPlanDay(plan.nextInstallment.scheduledDate)} · ${plan.nextInstallment.installmentNumber}/${plan.installmentCount}`
                : t("installments.plan-finished")
            }
          />
        </StatCardGrid>
        {plan.unmatchedCount > 0 ? (
          <p className="text-warning-text text-sm">
            {t("installments.unmatched-note", { count: plan.unmatchedCount })}
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          {t("installments.projections-note")}
        </p>
      </div>

      <Section
        id="installment-schedule-heading"
        title={t("installments.schedule")}
      >
        <ol className="border-border divide-border divide-y border-y">
          {plan.installments.map((installment) => (
            <InstallmentRow
              key={installment.installmentNumber}
              installment={installment}
              installmentCount={plan.installmentCount}
              currency={plan.currency}
              onLink={() => setLinkTarget(installment)}
              onUnlink={() => setUnlinkTarget(installment)}
            />
          ))}
        </ol>
      </Section>

      <InstallmentPlanFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode={{ kind: "edit", plan }}
        categories={categories}
      />

      <InstallmentLinkDialog
        plan={plan}
        installment={linkTarget}
        onOpenChange={(open) => {
          if (!open) setLinkTarget(null);
        }}
      />

      <AlertDialog
        open={unlinkTarget !== null}
        onOpenChange={(open) => {
          if (!open && !unlink.isPending) setUnlinkTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {unlinkTarget
                ? t("installments.unlink-title", {
                    number: unlinkTarget.installmentNumber,
                    count: plan.installmentCount,
                  })
                : null}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("installments.unlink-description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlink.isPending}>
              {t("cancel")}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              loading={unlink.isPending}
              disabled={unlink.isPending}
              onClick={() => void onUnlink()}
            >
              {t("installments.unlink-action")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("installments.delete-title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("installments.delete-description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePlan.isPending}>
              {t("cancel")}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              loading={deletePlan.isPending}
              disabled={deletePlan.isPending}
              onClick={() => void onDelete()}
            >
              {t("installments.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InstallmentRow({
  installment,
  installmentCount,
  currency,
  onLink,
  onUnlink,
}: {
  installment: Installment;
  installmentCount: number;
  currency: string;
  onLink: () => void;
  onUnlink: () => void;
}) {
  const t = useTranslations();
  const formatPlanDay = useFormatPlanDay();
  const formatCurrency = useFormatCurrency();
  const projected = installment.status === "upcoming";
  const numbers = {
    number: installment.installmentNumber,
    count: installmentCount,
  };

  return (
    <li
      data-status={installment.status}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 px-1 py-3",
        projected && "bg-muted/20",
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        <span className="text-muted-foreground w-12 shrink-0 font-mono text-sm tabular-nums">
          <span aria-hidden="true">
            {installment.installmentNumber}/{installmentCount}
          </span>
          <span className="sr-only">
            {t("installments.badge-label", {
              number: installment.installmentNumber,
              count: installmentCount,
            })}
          </span>
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-foreground font-mono text-sm tabular-nums">
            {formatPlanDay(installment.scheduledDate, { alwaysShowYear: true })}
          </span>
          {installment.dueDate ? (
            <span className="text-muted-foreground text-xs">
              {t("installments.statement-due")}{" "}
              <span className="font-mono tabular-nums">
                {formatPlanDay(installment.dueDate, { alwaysShowYear: true })}
              </span>
            </span>
          ) : null}
          {installment.status === "paid" &&
          installment.postedAmount !== null &&
          installment.postedDate ? (
            <span className="text-muted-foreground text-xs">
              {t("installments.posted", {
                amount: formatCurrency(installment.postedAmount, currency),
                date: formatPlanDay(installment.postedDate),
              })}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Badge
          variant={STATUS_VARIANT[installment.status]}
          className={cn(
            "font-normal",
            projected && "text-muted-foreground border-dashed",
          )}
        >
          {t(`installments.status-${installment.status}`)}
        </Badge>
        <Amount
          value={installment.amount}
          currency={currency}
          className={cn(
            "text-sm",
            projected ? "text-muted-foreground" : "text-foreground",
          )}
        />
        {installment.status === "paid" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onUnlink}
            aria-label={t("installments.unlink-action-label", numbers)}
          >
            <Link2Off className="size-4" aria-hidden="true" />
            {t("installments.unlink-action")}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={onLink}
            aria-label={t("installments.link-action-label", numbers)}
          >
            <Link2 className="size-4" aria-hidden="true" />
            {t("installments.link-action")}
          </Button>
        )}
      </div>
    </li>
  );
}
