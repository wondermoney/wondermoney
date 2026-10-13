"use client";

import { useFormatter, useTranslations } from "next-intl";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/Spinner";
import { Heading, Text } from "@/components/ui/Typography";
import useEnableBankingCredential, {
  type EnableBankingCredentialApiError,
  type EnableBankingCredentialStatus,
  useDeleteEnableBankingCredential,
} from "@/lib/api/user/useEnableBankingCredential";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";

import EnableBankingKeySetupDialog from "./EnableBankingKeySetupDialog";

const apiMessage = (error: unknown): string | undefined =>
  (error as EnableBankingCredentialApiError)?.response?.data?.message;

function Shell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("bankProvider");
  return (
    <div className="divide-y divide-border">
      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8">
        <div>
          <Heading variant="h2">{t("title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("description")}
          </Text>
        </div>
        <div className="space-y-6 rounded bg-card p-4 md:col-span-2">
          {children}
        </div>
      </div>
    </div>
  );
}

const badgeVariantForStatus = (
  status: EnableBankingCredentialStatus,
): "success" | "destructive" | "muted" => {
  switch (status) {
    case "active":
      return "success";
    case "invalid":
      return "destructive";
    case "revoked":
      return "muted";
  }
};

/**
 * BYOK Enable Banking credential settings (plan §6). This is the one-time
 * prerequisite credential surface — a sibling top-level Settings tab, not a
 * section under Connections/, since it's setup rather than a linked-account
 * view. Structurally mirrors Security/2FA.tsx: a status badge for a
 * per-user secret-ish setting, plus an enable/setup dialog.
 */
export default function EnableBankingKeySettings() {
  const t = useTranslations("bankProvider");
  const format = useFormatter();
  const notifyIfRateLimited = useRateLimitToast();
  const { data: credential, isLoading, error } = useEnableBankingCredential();
  const deleteCredential = useDeleteEnableBankingCredential();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isLoading) {
    return (
      <Shell>
        <Spinner />
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <Text className="text-destructive-text">{t("loadError")}</Text>
      </Shell>
    );
  }

  const status = credential?.status;
  const statusLabel = !status
    ? t("statusNotConfigured")
    : status === "active"
      ? t("statusActive")
      : status === "invalid"
        ? t("statusInvalid")
        : t("statusRevoked");

  const onConfirmRemove = () => {
    deleteCredential.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("toastRemoveSuccess"));
        setConfirmOpen(false);
      },
      onError: (err) => {
        if (notifyIfRateLimited(err)) return;
        toast.error(apiMessage(err) ?? t("toastRemoveError"));
      },
    });
  };

  return (
    <Shell>
      <div className="flex items-center gap-2">
        <Text>{t("statusLabel")}:</Text>
        <Badge
          className="uppercase"
          variant={status ? badgeVariantForStatus(status) : "muted"}
        >
          {statusLabel}
        </Badge>
      </div>

      <Text variant="mutedText" className="text-sm">
        {credential?.lastValidatedAt
          ? t("lastValidated", {
              date: format.dateTime(new Date(credential.lastValidatedAt), {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })
          : t("neverValidated")}
      </Text>

      {status === "invalid" && credential?.lastValidationError && (
        <Text className="text-destructive-text text-sm">
          {t("validationErrorLabel")} {credential.lastValidationError}
        </Text>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <EnableBankingKeySetupDialog
          triggerLabel={credential ? t("updateKey") : t("addKey")}
          isUpdate={!!credential}
        />
        {credential && (
          <Button variant="outline" onClick={() => setConfirmOpen(true)}>
            {t("removeKey")}
          </Button>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("removeDialogDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCredential.isPending}>
              {t("cancel")}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              loading={deleteCredential.isPending}
              disabled={deleteCredential.isPending}
              onClick={onConfirmRemove}
            >
              {t("removeDialogConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}
