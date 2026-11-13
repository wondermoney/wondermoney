"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Crown, MoreHorizontal, UserCog, UserMinus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { getApiErrorMessage } from "@/lib/api/errors";
import type {
  GrantableHouseholdRole,
  Household as HouseholdData,
  HouseholdMember,
} from "@/lib/api/household/types";
import useCreateHouseholdInvite from "@/lib/api/household/useCreateHouseholdInvite";
import useHousehold from "@/lib/api/household/useHousehold";
import useRemoveHouseholdMember from "@/lib/api/household/useRemoveHouseholdMember";
import useResendHouseholdInvite from "@/lib/api/household/useResendHouseholdInvite";
import useRevokeHouseholdInvite from "@/lib/api/household/useRevokeHouseholdInvite";
import useTransferHouseholdOwnership from "@/lib/api/household/useTransferHouseholdOwnership";
import useUpdateHouseholdMemberRole from "@/lib/api/household/useUpdateHouseholdMemberRole";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { useUser } from "@/lib/auth/user-context";
import { useSignOut } from "@/lib/auth/useSignOut";
import { householdErrorKey } from "@/lib/household/error-messages";
import {
  canChangeRole,
  canInvite,
  canLeave,
  canManageInvite,
  canRemoveMember,
  canTransferOwnership,
  DEFAULT_INVITE_ROLE,
  findMe,
  GRANTABLE_HOUSEHOLD_ROLES,
  grantableRoles,
  isHouseholdManager,
  roleChangeOptions,
  seatsRemaining,
} from "@/lib/household/permissions";

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
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
import { HouseholdRolePicker } from "./HouseholdRolePicker";

const memberLabel = (member: HouseholdMember): string =>
  member.firstName?.trim() || member.emailAddress;

const initials = (member: HouseholdMember): string =>
  (
    member.firstName?.trim()?.[0] ??
    member.emailAddress[0] ??
    "?"
  ).toUpperCase();

type MemberDialog =
  | { kind: "leave" }
  | { kind: "remove"; member: HouseholdMember }
  | { kind: "role"; member: HouseholdMember }
  | { kind: "transfer"; member: HouseholdMember };

function Shell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("household");
  return (
    <div className="divide-border divide-y">
      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 py-10 md:grid-cols-3">
        <div>
          <Heading variant="h2">{t("title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("description")}
          </Text>
        </div>
        <div className="bg-card space-y-8 rounded p-4 md:col-span-2">
          {children}
        </div>
      </div>
    </div>
  );
}

/** A translated sentence for a household refusal, else the API's own, else a generic one. */
function useHouseholdErrorToast() {
  const t = useTranslations("household");
  const notifyIfRateLimited = useRateLimitToast();
  return (error: unknown) => {
    if (notifyIfRateLimited(error)) return;
    const key = householdErrorKey(error);
    toast.error(
      key ? t(`errors.${key}`) : (getApiErrorMessage(error) ?? t("toast.error")),
    );
  };
}

export default function Household() {
  const t = useTranslations("household");
  const user = useUser();
  const { data, isLoading, error } = useHousehold();

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

  return (
    <Shell>
      <HouseholdSettings household={data} email={user?.email} />
    </Shell>
  );
}

function HouseholdSettings({
  household,
  email,
}: {
  household: HouseholdData;
  email: null | string | undefined;
}) {
  const t = useTranslations("household");
  const showError = useHouseholdErrorToast();
  const me = findMe(household, email);
  const removeMember = useRemoveHouseholdMember();
  const updateRole = useUpdateHouseholdMemberRole();
  const transferOwnership = useTransferHouseholdOwnership();
  const signOut = useSignOut();

  const [dialog, setDialog] = useState<MemberDialog | null>(null);
  const [nextRole, setNextRole] = useState<GrantableHouseholdRole>(
    DEFAULT_INVITE_ROLE,
  );
  const close = () => setDialog(null);

  const openRoleDialog = (member: HouseholdMember) => {
    const options = roleChangeOptions(me, member);
    const current = options.find((role) => role === member.role);
    setNextRole(current ?? options[0] ?? DEFAULT_INVITE_ROLE);
    setDialog({ kind: "role", member });
  };

  const onRemoveOrLeave = () => {
    if (!dialog || (dialog.kind !== "remove" && dialog.kind !== "leave")) return;
    const target = dialog.kind === "remove" ? dialog.member : me;
    if (!target) return;
    removeMember.mutate(target.appuserKey, {
      onSuccess: () => {
        if (dialog.kind === "leave") {
          // Someone who leaves has no household until they sign in again,
          // which gives them their own back.
          toast.success(t("toast.left"));
          void signOut("/auth/login");
          return;
        }
        toast.success(t("toast.memberRemoved", { name: memberLabel(target) }));
        close();
      },
      onError: showError,
    });
  };

  const onSaveRole = () => {
    if (dialog?.kind !== "role") return;
    const { member } = dialog;
    updateRole.mutate(
      { appuserKey: member.appuserKey, role: nextRole },
      {
        onSuccess: () => {
          toast.success(
            t("toast.roleChanged", {
              name: memberLabel(member),
              role: t(`roles.${nextRole}`),
            }),
          );
          close();
        },
        onError: showError,
      },
    );
  };

  const onTransfer = () => {
    if (dialog?.kind !== "transfer") return;
    const { member } = dialog;
    transferOwnership.mutate(member.appuserKey, {
      onSuccess: () => {
        toast.success(
          t("toast.ownershipTransferred", { name: memberLabel(member) }),
        );
        close();
      },
      onError: showError,
    });
  };

  const seatsUsed = household.maxMembers - seatsRemaining(household);

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Heading variant="h4">{t("members.heading")}</Heading>
          {isHouseholdManager(me?.role) && (
            <Text className="text-muted-foreground text-xs">
              {t("members.seats", {
                max: household.maxMembers,
                used: seatsUsed,
              })}
            </Text>
          )}
        </div>
        <ul className="divide-border divide-y rounded-md border">
          {household.members.map((member) => (
            <MemberRow
              key={member.appuserKey}
              member={member}
              me={me}
              onChangeRole={() => openRoleDialog(member)}
              onRemove={() => setDialog({ kind: "remove", member })}
              onTransfer={() => setDialog({ kind: "transfer", member })}
            />
          ))}
        </ul>
      </div>

      <PendingInvites household={household} me={me} />

      {isHouseholdManager(me?.role) &&
        (canInvite(me?.role, household) ? (
          <InviteForm roles={grantableRoles(me?.role)} />
        ) : (
          <div className="flex flex-col gap-2">
            <Heading variant="h4">{t("invite.heading")}</Heading>
            <Text className="text-muted-foreground text-sm">
              {t("invite.full", { max: household.maxMembers })}
            </Text>
          </div>
        ))}

      {canLeave(me) && (
        <div>
          <Button
            variant="destructive"
            onClick={() => setDialog({ kind: "leave" })}
          >
            {t("actions.leave")}
          </Button>
        </div>
      )}

      <AlertDialog
        open={dialog?.kind === "remove" || dialog?.kind === "leave"}
        onOpenChange={(open) => !open && close()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog?.kind === "remove"
                ? t("removeDialog.title", { name: memberLabel(dialog.member) })
                : t("leaveDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog?.kind === "remove"
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
              onClick={onRemoveOrLeave}
            >
              {dialog?.kind === "remove"
                ? t("removeDialog.confirm")
                : t("leaveDialog.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dialog?.kind === "transfer"}
        onOpenChange={(open) => !open && close()}
      >
        <AlertDialogContent>
          {dialog?.kind === "transfer" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("transferDialog.title", {
                    name: memberLabel(dialog.member),
                  })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("transferDialog.description", {
                    name: memberLabel(dialog.member),
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={transferOwnership.isPending}>
                  {t("cancel")}
                </AlertDialogCancel>
                <Button
                  loading={transferOwnership.isPending}
                  disabled={transferOwnership.isPending}
                  onClick={onTransfer}
                >
                  {t("transferDialog.confirm", {
                    name: memberLabel(dialog.member),
                  })}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={dialog?.kind === "role"}
        onOpenChange={(open) => !open && close()}
      >
        <DialogContent>
          {dialog?.kind === "role" && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t("roleDialog.title", { name: memberLabel(dialog.member) })}
                </DialogTitle>
                <DialogDescription>
                  {t("roleDialog.description")}
                </DialogDescription>
              </DialogHeader>
              <HouseholdRolePicker
                name="member-role"
                legend={t("invite.roleLabel")}
                roles={roleChangeOptions(me, dialog.member)}
                value={nextRole}
                onChange={setNextRole}
                disabled={updateRole.isPending}
              />
              <DialogFooter>
                <Button
                  variant="secondary"
                  disabled={updateRole.isPending}
                  onClick={close}
                >
                  {t("cancel")}
                </Button>
                <Button
                  loading={updateRole.isPending}
                  disabled={
                    updateRole.isPending || nextRole === dialog.member.role
                  }
                  onClick={onSaveRole}
                >
                  {t("roleDialog.save")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function MemberRow({
  member,
  me,
  onChangeRole,
  onRemove,
  onTransfer,
}: {
  member: HouseholdMember;
  me: HouseholdMember | undefined;
  onChangeRole: () => void;
  onRemove: () => void;
  onTransfer: () => void;
}) {
  const t = useTranslations("household");
  const changeRole = canChangeRole(me, member);
  const transfer = canTransferOwnership(me, member);
  const remove = canRemoveMember(me, member);

  return (
    <li className="flex items-center gap-3 p-3">
      <Avatar className="size-9">
        <AvatarFallback>{initials(member)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">
          {memberLabel(member)}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {member.emailAddress}
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {member.appuserKey === me?.appuserKey && (
          <Badge variant="secondary">{t("members.you")}</Badge>
        )}
        <Badge variant={member.role === "owner" ? "secondary" : "muted"}>
          {t(`roles.${member.role}`)}
        </Badge>
        {(changeRole || transfer || remove) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="size-11 p-0 md:size-8"
                aria-label={t("members.actionsLabel", {
                  name: memberLabel(member),
                })}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {changeRole && (
                <DropdownMenuItem
                  className="flex items-center gap-2"
                  onSelect={onChangeRole}
                >
                  <UserCog className="size-4" /> {t("members.changeRole")}
                </DropdownMenuItem>
              )}
              {transfer && (
                <DropdownMenuItem
                  className="flex items-center gap-2"
                  onSelect={onTransfer}
                >
                  <Crown className="size-4" /> {t("members.makeOwner")}
                </DropdownMenuItem>
              )}
              {remove && (
                <DropdownMenuItem
                  className="text-destructive-text flex items-center gap-2"
                  onSelect={onRemove}
                >
                  <UserMinus className="size-4" /> {t("members.remove")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

function PendingInvites({
  household,
  me,
}: {
  household: HouseholdData;
  me: HouseholdMember | undefined;
}) {
  const t = useTranslations("household");
  const format = useFormatter();
  const showError = useHouseholdErrorToast();
  const resendInvite = useResendHouseholdInvite();
  const revokeInvite = useRevokeHouseholdInvite();

  if (household.pendingInvites.length === 0) return null;

  const onResend = (householdInviteKey: number) =>
    resendInvite.mutate(householdInviteKey, {
      onSuccess: () => toast.success(t("toast.inviteResent")),
      onError: showError,
    });

  const onRevoke = (householdInviteKey: number) =>
    revokeInvite.mutate(householdInviteKey, {
      onSuccess: () => toast.success(t("toast.inviteRevoked")),
      onError: showError,
    });

  return (
    <div className="flex flex-col gap-2">
      <Heading variant="h4">{t("pending.heading")}</Heading>
      <ul className="divide-border divide-y rounded-md border">
        {household.pendingInvites.map((invite) => {
          const key = invite.householdInviteKey;
          const resending =
            resendInvite.isPending && resendInvite.variables === key;
          const revoking =
            revokeInvite.isPending && revokeInvite.variables === key;
          return (
            <li key={key} className="flex flex-wrap items-center gap-3 p-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {t("pending.sentTo", { email: invite.email })}
                </span>
                <span className="text-muted-foreground text-xs">
                  {t("pending.expires", {
                    date: format.dateTime(new Date(invite.expiresAt), {
                      dateStyle: "medium",
                    }),
                  })}
                </span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Badge variant="muted">{t(`roles.${invite.role}`)}</Badge>
                {canManageInvite(me?.role, invite.role) && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={resending}
                      disabled={resending || revoking}
                      onClick={() => onResend(key)}
                    >
                      {t("pending.resend")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={revoking}
                      disabled={resending || revoking}
                      onClick={() => onRevoke(key)}
                    >
                      {t("pending.revoke")}
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function InviteForm({ roles }: { roles: GrantableHouseholdRole[] }) {
  const t = useTranslations("household");
  const showError = useHouseholdErrorToast();
  const createInvite = useCreateHouseholdInvite();

  const inviteSchema = z.object({
    email: z.email(t("invite.invalidEmail")),
    role: z.enum(GRANTABLE_HOUSEHOLD_ROLES),
  });
  const defaultRole = roles.includes(DEFAULT_INVITE_ROLE)
    ? DEFAULT_INVITE_ROLE
    : (roles[0] ?? DEFAULT_INVITE_ROLE);
  const form = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: defaultRole },
  });

  const onInvite = form.handleSubmit((values) => {
    createInvite.mutate(values, {
      onSuccess: () => {
        toast.success(t("toast.inviteSent"));
        form.reset({ email: "", role: defaultRole });
      },
      onError: showError,
    });
  });

  return (
    <div className="flex flex-col gap-2">
      <Heading variant="h4">{t("invite.heading")}</Heading>
      <Text className="text-muted-foreground text-sm">
        {t("invite.description")}
      </Text>
      <Form {...form}>
        <form onSubmit={onInvite} className="flex flex-col gap-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("invite.emailLabel")}</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="off"
                    placeholder={t("invite.emailPlaceholder")}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <HouseholdRolePicker
                name="invite-role"
                legend={t("invite.roleLabel")}
                roles={roles}
                value={field.value}
                onChange={field.onChange}
                disabled={createInvite.isPending}
              />
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
  );
}
