"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { useUser } from "@/lib/auth/user-context";

import type {
  HouseholdApiError,
  HouseholdMember,
} from "../../lib/api/household/types";
import useCreateHouseholdInvite from "../../lib/api/household/useCreateHouseholdInvite";
import useHousehold from "../../lib/api/household/useHousehold";
import useRemoveHouseholdMember from "../../lib/api/household/useRemoveHouseholdMember";
import useResendHouseholdInvite from "../../lib/api/household/useResendHouseholdInvite";
import useRevokeHouseholdInvite from "../../lib/api/household/useRevokeHouseholdInvite";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/Form";
import { Input } from "../ui/input";
import { Spinner } from "../ui/Spinner";
import { Heading, Text } from "../ui/Typography";

const apiMessage = (error: unknown): string | undefined =>
  (error as HouseholdApiError)?.response?.data?.message;

const memberLabel = (member: HouseholdMember): string =>
  member.firstName?.trim() || member.emailAddress;

const initials = (member: HouseholdMember): string =>
  (member.firstName?.trim()?.[0] ?? member.emailAddress[0] ?? "?").toUpperCase();

function Shell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("household");
  return (
    <div className="divide-y divide-border">
      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8">
        <div>
          <Heading variant="h2">{t("title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("description")}
          </Text>
        </div>
        <div className="space-y-8 rounded bg-card p-4 md:col-span-2">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function Household() {
  const t = useTranslations("household");
  const notifyIfRateLimited = useRateLimitToast();
  const format = useFormatter();
  const user = useUser();
  const { data, isLoading, error } = useHousehold();

  const inviteSchema = z.object({
    email: z.string().email(t("invite.invalidEmail")),
  });
  const form = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "" },
  });

  const createInvite = useCreateHouseholdInvite();
  const revokeInvite = useRevokeHouseholdInvite();
  const resendInvite = useResendHouseholdInvite();
  const removeMember = useRemoveHouseholdMember();

  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isLoading) {
    return (
      <Shell>
        <Spinner />
      </Shell>
    );
  }

  if (error || !data) {
    return (
      <Shell>
        <Text className="text-destructive-text">{t("loadError")}</Text>
      </Shell>
    );
  }

  const members = data.members;
  const pendingInvite = data.pendingInvite;
  const currentEmail = user?.email?.toLowerCase();
  const me = members.find((m) => m.emailAddress.toLowerCase() === currentEmail);
  const isOwner = me?.role === "owner";
  const partner = members.find((m) => m.role === "member");
  const canInvite = isOwner && members.length < 2 && !pendingInvite;

  const onInvite = form.handleSubmit((values) => {
    createInvite.mutate(
      { email: values.email },
      {
        onSuccess: () => {
          toast.success(t("toast.inviteSent"));
          form.reset();
        },
        onError: (err) => {
          if (notifyIfRateLimited(err)) return;
          toast.error(apiMessage(err) ?? t("toast.error"));
        },
      },
    );
  });

  const onResend = () => {
    if (!pendingInvite) return;
    resendInvite.mutate(pendingInvite.householdInviteKey, {
      onSuccess: () => toast.success(t("toast.inviteResent")),
      onError: (err) => {
        if (notifyIfRateLimited(err)) return;
        toast.error(apiMessage(err) ?? t("toast.error"));
      },
    });
  };

  const onRevoke = () => {
    if (!pendingInvite) return;
    revokeInvite.mutate(pendingInvite.householdInviteKey, {
      onSuccess: () => toast.success(t("toast.inviteRevoked")),
      onError: (err) => {
        if (notifyIfRateLimited(err)) return;
        toast.error(apiMessage(err) ?? t("toast.error"));
      },
    });
  };

  // Owner removing the partner, or a member leaving (removing self).
  const confirmTarget = isOwner ? partner : me;
  const onConfirmDestructive = () => {
    if (!confirmTarget) return;
    removeMember.mutate(confirmTarget.appuserKey, {
      onSuccess: () => {
        toast.success(isOwner ? t("toast.memberRemoved") : t("toast.left"));
        setConfirmOpen(false);
      },
      onError: (err) => {
        if (notifyIfRateLimited(err)) return;
        toast.error(apiMessage(err) ?? t("toast.error"));
      },
    });
  };

  return (
    <Shell>
      <div className="flex flex-col gap-3">
        <Heading variant="h4">{t("members.heading")}</Heading>
        <ul className="divide-y divide-border rounded-md border">
          {members.map((member) => (
            <li
              key={member.appuserKey}
              className="flex items-center gap-3 p-3"
            >
              <Avatar className="size-9">
                <AvatarFallback>{initials(member)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {memberLabel(member)}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {member.emailAddress}
                </span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {member.appuserKey === me?.appuserKey && (
                  <Badge variant="secondary">{t("members.you")}</Badge>
                )}
                <Badge variant={member.role === "owner" ? "secondary" : "muted"}>
                  {member.role === "owner"
                    ? t("members.roleOwner")
                    : t("members.roleMember")}
                </Badge>
                {isOwner && member.role === "member" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmOpen(true)}
                  >
                    {t("actions.remove")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {pendingInvite && isOwner && (
        <div className="flex flex-col gap-2">
          <Heading variant="h4">{t("pending.heading")}</Heading>
          <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">
                {t("pending.sentTo", { email: pendingInvite.email })}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("pending.expires", {
                  date: format.dateTime(new Date(pendingInvite.expiresAt), {
                    dateStyle: "medium",
                  }),
                })}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                loading={resendInvite.isPending}
                disabled={resendInvite.isPending}
                onClick={onResend}
              >
                {t("pending.resend")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                loading={revokeInvite.isPending}
                disabled={revokeInvite.isPending}
                onClick={onRevoke}
              >
                {t("pending.revoke")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {canInvite && (
        <div className="flex flex-col gap-2">
          <Heading variant="h4">{t("invite.heading")}</Heading>
          <Text className="text-sm text-muted-foreground">
            {t("invite.description")}
          </Text>
          <Form {...form}>
            <form onSubmit={onInvite} className="flex flex-col gap-3">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("invite.emailLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
                        placeholder={t("invite.emailPlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div>
                <Button
                  type="submit"
                  loading={createInvite.isPending}
                  disabled={createInvite.isPending}
                >
                  {t("invite.submit")}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      )}

      {!isOwner && me && (
        <div>
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            {t("actions.leave")}
          </Button>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isOwner
                ? t("removeDialog.title", {
                    name: confirmTarget ? memberLabel(confirmTarget) : "",
                  })
                : t("leaveDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isOwner
                ? t("removeDialog.description")
                : t("leaveDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMember.isPending}>
              {t("cancel")}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              loading={removeMember.isPending}
              disabled={removeMember.isPending}
              onClick={onConfirmDestructive}
            >
              {isOwner ? t("removeDialog.confirm") : t("leaveDialog.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}
