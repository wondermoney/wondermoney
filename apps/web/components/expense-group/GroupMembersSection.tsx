"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import type {
  ExpenseGroup,
  ExpenseGroupMember,
} from "@/lib/api/expense-group/types";
import {
  useAddExpenseGroupMember,
  useRemoveExpenseGroupMember,
  useUpdateExpenseGroupMember,
} from "@/lib/api/expense-group/useExpenseGroups";
import useHousehold from "@/lib/api/household/useHousehold";

import { householdMemberName } from "./CreateExpenseGroupDialog";
import {
  keepEnterInside,
  selectClassName,
  useGroupErrorMessage,
  useGroupErrorToast,
} from "./shared";

/** The person's name, marked when it is the viewer. */
export function useMemberLabel() {
  const t = useTranslations("expenseGroups.detail");
  return (member: ExpenseGroupMember) =>
    member.isYou ? t("you", { name: member.name }) : member.name;
}

/** Renaming a person (and their reference email), inline in their row. */
function MemberEditor({
  groupId,
  member,
  onDone,
}: {
  groupId: number;
  member: ExpenseGroupMember;
  onDone: () => void;
}) {
  const t = useTranslations("expenseGroups");
  const tRoot = useTranslations();
  const errorMessage = useGroupErrorMessage();
  const update = useUpdateExpenseGroupMember(groupId);
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (name.trim() === "") {
      setError(t("create.person-name-required"));
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({
        memberId: member.expenseGroupMemberKey,
        name: name.trim(),
        ...(member.isHouseholdMember ? {} : { email: email.trim() || null }),
      });
    } catch (refusal) {
      setError(errorMessage(refusal));
      return;
    }
    toast.success(t("detail.member-updated"));
    onDone();
  };

  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-start">
      <Input
        aria-label={t("create.person-name")}
        className="h-9 px-3"
        maxLength={100}
        value={name}
        aria-invalid={error ? true : undefined}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => keepEnterInside(event, () => void save())}
      />
      {member.isHouseholdMember ? null : (
        <Input
          type="email"
          aria-label={t("create.person-email")}
          placeholder={t("create.person-email")}
          className="h-9 px-3"
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onKeyDown={(event) => keepEnterInside(event, () => void save())}
        />
      )}
      <div className="flex shrink-0 gap-2">
        <Button
          type="button"
          size="sm"
          loading={update.isPending}
          onClick={() => void save()}
        >
          {t("detail.save")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {tRoot("cancel")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-destructive-text text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** "Add person": someone outside the household by name, or a household member not in it yet. */
function AddPersonForm({
  group,
  onDone,
}: {
  group: ExpenseGroup;
  onDone: () => void;
}) {
  const t = useTranslations("expenseGroups");
  const tRoot = useTranslations();
  const errorMessage = useGroupErrorMessage();
  const add = useAddExpenseGroupMember(group.expenseGroupKey);
  const household = useHousehold();
  const inGroup = new Set(
    group.members.map((member) => member.appuserKey).filter(Boolean),
  );
  const available = (household.data?.members ?? []).filter(
    (member) => !inGroup.has(member.appuserKey),
  );
  // "" is someone outside the household; otherwise a household member's appuserKey.
  const [who, setWho] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const householdMember = available.find(
      (member) => String(member.appuserKey) === who,
    );
    if (!householdMember && name.trim() === "") {
      setError(t("create.person-name-required"));
      return;
    }
    setError(null);
    try {
      await add.mutateAsync(
        householdMember
          ? {
              name: householdMemberName(householdMember),
              householdMemberId: householdMember.appuserKey,
            }
          : { name: name.trim(), email: email.trim() || null },
      );
    } catch (refusal) {
      setError(errorMessage(refusal));
      return;
    }
    toast.success(t("detail.member-added"));
    onDone();
  };

  return (
    <form
      className="bg-muted space-y-3 rounded-md p-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {available.length > 0 ? (
        <div className="space-y-1">
          <Label htmlFor={`add-person-${group.expenseGroupKey}`}>
            {t("add-person")}
          </Label>
          <select
            id={`add-person-${group.expenseGroupKey}`}
            className={selectClassName}
            value={who}
            onChange={(event) => setWho(event.target.value)}
          >
            <option value="">{t("create.outside")}</option>
            {available.map((member) => (
              <option key={member.appuserKey} value={member.appuserKey}>
                {householdMemberName(member)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {who === "" ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label={t("create.person-name")}
            placeholder={t("create.person-name")}
            maxLength={100}
            value={name}
            aria-invalid={error ? true : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            type="email"
            aria-label={t("create.person-email")}
            placeholder={t("create.person-email")}
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
      ) : null}
      {who === "" ? (
        <p className="text-muted-foreground text-xs">
          {t("create.email-hint")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive-text text-xs">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={add.isPending}>
          {t("add-person")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {tRoot("cancel")}
        </Button>
      </div>
    </form>
  );
}

/** The group's people: who is of the household, and rename, remove and add for writers. */
export function GroupMembersSection({
  group,
  readOnly,
}: {
  group: ExpenseGroup;
  readOnly: boolean;
}) {
  const t = useTranslations("expenseGroups");
  const tRoot = useTranslations();
  const label = useMemberLabel();
  const notifyError = useGroupErrorToast();
  const remove = useRemoveExpenseGroupMember(group.expenseGroupKey);
  const [editingKey, setEditingKey] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ExpenseGroupMember | null>(null);

  const onRemove = async (member: ExpenseGroupMember) => {
    try {
      await remove.mutateAsync(member.expenseGroupMemberKey);
    } catch (error) {
      notifyError(error);
      return;
    } finally {
      setRemoving(null);
    }
    toast.success(t("detail.member-removed"));
  };

  return (
    <section className="space-y-3" aria-labelledby="group-people">
      <div className="flex items-center justify-between gap-3">
        <h2 id="group-people" className="text-base font-semibold">
          {t("detail.people")}
        </h2>
        {readOnly || adding ? null : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-4" aria-hidden />
            {t("add-person")}
          </Button>
        )}
      </div>
      {adding ? (
        <AddPersonForm group={group} onDone={() => setAdding(false)} />
      ) : null}
      <Card>
        <ul className="divide-border divide-y">
          {group.members.map((member) => (
            <li
              key={member.expenseGroupMemberKey}
              className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              {editingKey === member.expenseGroupMemberKey ? (
                <MemberEditor
                  groupId={group.expenseGroupKey}
                  member={member}
                  onDone={() => setEditingKey(null)}
                />
              ) : (
                <>
                  <span className="min-w-0 space-y-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate">{label(member)}</span>
                      {member.isHouseholdMember ? (
                        <Badge variant="muted" className="font-normal">
                          {t("detail.household-member")}
                        </Badge>
                      ) : null}
                    </span>
                    {member.email ? (
                      <span className="text-muted-foreground block truncate text-xs">
                        {member.email}
                      </span>
                    ) : null}
                  </span>
                  {readOnly ? null : (
                    <span className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        aria-label={t("detail.rename-label", {
                          name: member.name,
                        })}
                        onClick={() =>
                          setEditingKey(member.expenseGroupMemberKey)
                        }
                      >
                        {t("detail.rename")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        aria-label={t("detail.remove-label", {
                          name: member.name,
                        })}
                        disabled={remove.isPending}
                        onClick={() => setRemoving(member)}
                      >
                        {t("detail.remove")}
                      </Button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("detail.remove-title", { name: removing?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("detail.remove-description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tRoot("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (removing) void onRemove(removing);
              }}
            >
              {t("detail.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
