"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import AccountAddSyncModal from "@/components/account/AccountCreateSyncModal";
import { Alert } from "@/components/ui/Alert";
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
import { getApiErrorCode } from "@/lib/api/errors";
import useEnableBankingCredential, {
  type EnableBankingCredentialApiError,
  type EnableBankingCredentialStatus,
  useDeleteEnableBankingCredential,
} from "@/lib/api/user/useEnableBankingCredential";
import { useProfileField } from "@/lib/api/user/useProfile";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { useIsHouseholdViewer } from "@/lib/household/useIsHouseholdViewer";

import AuthenticatorCodeField from "./AuthenticatorCodeField";
import {
  enableBankingErrorKey,
  isKnownEnableBankingError,
} from "./enable-banking-errors";
import { isTotpError } from "./enable-banking-setup-steps";
import EnableBankingKeySetupDialog from "./EnableBankingKeySetupDialog";
import EnableBankingSetupWizard from "./EnableBankingSetupWizard";
import {
  useReopenAfterSignIn,
  useSensitiveSession,
  useSignInAgain,
} from "./sign-in-again";

const apiMessage = (error: unknown): string | undefined =>
  (error as EnableBankingCredentialApiError)?.response?.data?.message;

function Shell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("bankProvider");
  return (
    <div className="divide-border divide-y">
      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 py-10 md:grid-cols-3">
        <div>
          <Heading variant="h2">{t("title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("description")}
          </Text>
        </div>
        <div className="bg-card space-y-6 rounded p-4 md:col-span-2">
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
    case "pending":
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
  // The server's shared credential covers this household: a key of their own is optional.
  const { data: sharedCredential } = useProfileField(
    (profile) => profile.bankSyncCredentials === "instance",
  );
  const deleteCredential = useDeleteEnableBankingCredential();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Removing the key needs a recent sign-in and, with two-factor on, the authenticator code.
  const id = useId();
  const { sessionFresh, twoFactorEnabled } = useSensitiveSession();
  const signInAgain = useSignInAgain();
  const [totpCode, setTotpCode] = useState("");
  const [totpAsked, setTotpAsked] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [staleSession, setStaleSession] = useState(false);
  const removeNeedsSignIn = !sessionFresh || staleSession;
  const showTotp = twoFactorEnabled || totpAsked;
  // Back from signing in again to remove the key: ask again.
  useReopenAfterSignIn("remove", () => setConfirmOpen(true));
  const [wizardOpen, setWizardOpen] = useState(false);
  const isViewer = useIsHouseholdViewer();
  const [bankListOpen, setBankListOpen] = useState(false);

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
        : status === "pending"
          ? t("statusPending")
          : t("statusRevoked");
  // A key of one's own, as opposed to only a generated one still waiting for its application ID.
  const hasKey = !!credential && status !== "pending";
  const pendingExpiresAt = credential?.pending?.expiresAt ?? null;

  const onConfirmOpenChange = (next: boolean) => {
    setConfirmOpen(next);
    if (!next) {
      setTotpCode("");
      setRemoveError(null);
      setStaleSession(false);
    }
  };

  const onConfirmRemove = () => {
    setRemoveError(null);
    // The code is used once: whatever the answer, the next attempt asks for a fresh one.
    const code = totpCode.trim();
    setTotpCode("");
    deleteCredential.mutate(code ? { totpCode: code } : {}, {
      onSuccess: () => {
        toast.success(t("toastRemoveSuccess"));
        onConfirmOpenChange(false);
      },
      onError: (err) => {
        if (notifyIfRateLimited(err)) return;
        if (isTotpError(err)) setTotpAsked(true);
        if (getApiErrorCode(err) === "session_not_fresh") {
          setStaleSession(true);
          return;
        }
        if (isKnownEnableBankingError(err)) {
          setRemoveError(t(`generated.${enableBankingErrorKey(err)}`));
          return;
        }
        toast.error(apiMessage(err) ?? t("toastRemoveError"));
      },
    });
  };

  return (
    <Shell>
      {sharedCredential ? (
        <Text variant="mutedText" className="text-sm">
          {t("sharedAvailable")}
        </Text>
      ) : null}
      <div className="flex items-center gap-2">
        <Text>{t("statusLabel")}:</Text>
        <Badge variant={status ? badgeVariantForStatus(status) : "muted"}>
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

      {pendingExpiresAt ? (
        <Text variant="mutedText" className="text-sm">
          {t("pendingWaiting", {
            date: format.dateTime(new Date(pendingExpiresAt), {
              dateStyle: "medium",
            }),
          })}
        </Text>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {/* A viewer cannot link a bank, so the setup that leads to one is not offered. */}
        {isViewer ? null : (
          <Button
            className="h-9 rounded-md px-3 md:h-10 md:px-4 md:py-2"
            onClick={() => setWizardOpen(true)}
          >
            {pendingExpiresAt ? t("continueSetup") : t("createKeyCta")}
          </Button>
        )}
        <EnableBankingKeySetupDialog
          triggerLabel={hasKey ? t("updateKey") : t("haveKeyCta")}
          isUpdate={hasKey}
          triggerVariant="outline"
        />
        {credential && (
          <Button variant="outline" onClick={() => setConfirmOpen(true)}>
            {t("removeKey")}
          </Button>
        )}
      </div>

      <EnableBankingSetupWizard
        entry="settings"
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onChooseBank={() => setBankListOpen(true)}
      />
      <AccountAddSyncModal isOpen={bankListOpen} setOpen={setBankListOpen} />

      <AlertDialog
        open={confirmOpen && Boolean(credential)}
        onOpenChange={onConfirmOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("removeDialogDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeNeedsSignIn ? (
            <Text variant="mutedText" className="text-sm">
              {t("removeSignInAgain")}
            </Text>
          ) : showTotp ? (
            <AuthenticatorCodeField
              id={`${id}-remove-totp`}
              value={totpCode}
              onChange={setTotpCode}
            />
          ) : null}
          {removeError && !removeNeedsSignIn ? (
            <Alert variant="destructive" className="text-sm">
              {removeError}
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCredential.isPending}>
              {t("cancel")}
            </AlertDialogCancel>
            {removeNeedsSignIn ? (
              <Button type="button" onClick={() => void signInAgain("remove")}>
                {t("wizard.signInAgain.action")}
              </Button>
            ) : (
              <Button
                variant="destructive"
                loading={deleteCredential.isPending}
                disabled={deleteCredential.isPending}
                onClick={onConfirmRemove}
              >
                {t("removeDialogConfirm")}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}
