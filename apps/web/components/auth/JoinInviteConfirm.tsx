"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import type { GrantableHouseholdRole } from "@/lib/api/household/types";
import useAcceptHouseholdInvite from "@/lib/api/household/useAcceptHouseholdInvite";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import {
  type HouseholdErrorKey,
  householdErrorKey,
} from "@/lib/household/error-messages";

import { Alert, AlertDescription, AlertTitle } from "../ui/Alert";
import { Button } from "../ui/button";
import { Link } from "../ui/Link";
import { Text } from "../ui/Typography";
import { JoinLoggedInBlock } from "./JoinLoggedInBlock";

/** Refusals after which pressing Join again cannot succeed. */
const FINAL_REFUSALS: ReadonlySet<string> = new Set<HouseholdErrorKey>([
  "already_household_member",
  "invite_already_used",
  "invite_email_mismatch",
  "invite_expired",
  "invite_invalid",
]);

export interface JoinInviteConfirmProps {
  token: string;
  locale: string;
  instanceName: string;
  invitedEmail: string;
  signedInEmail: null | string;
  householdName?: null | string;
  inviterName: null | string;
  /** Absent from an API older than roles, whose invites were all member invites. */
  role?: GrantableHouseholdRole;
}

/**
 * /join for someone already signed in: names the household and the role, says
 * what happens to the account's current household, and accepts the invite only
 * when the Join button is pressed.
 */
export function JoinInviteConfirm({
  token,
  locale,
  instanceName,
  invitedEmail,
  signedInEmail,
  householdName,
  inviterName,
  role = "member",
}: JoinInviteConfirmProps) {
  const t = useTranslations("household");
  const notifyIfRateLimited = useRateLimitToast();
  const accept = useAcceptHouseholdInvite(locale);
  const [refusal, setRefusal] = useState<HouseholdErrorKey | "unknown" | null>(
    null,
  );

  const emailMismatch =
    signedInEmail !== null &&
    signedInEmail.toLowerCase() !== invitedEmail.toLowerCase();

  const title = householdName
    ? t("join.confirmTitleNamed", { household: householdName })
    : inviterName
      ? t("join.confirmTitleInviter", { name: inviterName })
      : t("join.confirmTitleGeneric");

  const onAccept = () => {
    setRefusal(null);
    accept.mutate(token, {
      onError: (error) => {
        if (notifyIfRateLimited(error)) return;
        setRefusal(householdErrorKey(error) ?? "unknown");
      },
    });
  };

  if (emailMismatch) {
    return (
      <div className="mt-8 flex flex-col gap-6">
        <h1 className="text-foreground text-2xl leading-9 font-bold tracking-tight">
          {t("join.emailMismatchTitle")}
        </h1>
        <Text variant="mutedText" className="text-sm leading-6">
          {t("join.emailMismatchBody", {
            current: signedInEmail,
            invited: invitedEmail,
          })}
        </Text>
        <JoinLoggedInBlock token={token} variant="default" />
      </div>
    );
  }

  const joiningDone = accept.isSuccess;
  const canRetry = refusal === null || !FINAL_REFUSALS.has(refusal);

  return (
    <div className="mt-8 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-foreground text-2xl leading-9 font-bold tracking-tight">
          {title}
        </h1>
        <Text className="text-foreground text-sm leading-6">
          {t("join.confirmRole", { role: t(`roles.${role}`) })}{" "}
          {t(`roleDescriptions.${role}`)}
        </Text>
        {signedInEmail && (
          <Text variant="mutedText" className="text-xs leading-6">
            {t("join.signedInAs", { email: signedInEmail })}
          </Text>
        )}
      </div>

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="text-foreground text-sm font-semibold">
          {t("join.dataHeading")}
        </h2>
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm leading-6">
          <li>{t("join.dataRequirement")}</li>
          <li>{t("join.dataStaysBehind")}</li>
          <li>{t("join.dataBanks")}</li>
          <li>{t("join.dataYours")}</li>
        </ul>
      </section>

      {refusal && (
        <Alert variant="destructive">
          <AlertTitle>{t("join.errorTitle")}</AlertTitle>
          <AlertDescription>
            {refusal === "unknown"
              ? t("toast.error")
              : t(`errors.${refusal}`)}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3">
        {canRetry ? (
          <Button
            className="w-full font-semibold"
            loading={accept.isPending || joiningDone}
            disabled={accept.isPending || joiningDone}
            onClick={onAccept}
          >
            {t("join.accept")}
          </Button>
        ) : (
          refusal === "already_household_member" && (
            <Link
              href="/"
              className="text-primary text-center text-sm font-semibold underline underline-offset-2 hover:decoration-2"
            >
              {t("join.backToApp", { instanceName })}
            </Link>
          )
        )}
        <JoinLoggedInBlock token={token} />
      </div>
    </div>
  );
}
