"use client";

import { useTranslations } from "next-intl";

import {
  choicesFor,
  shareableMembers,
  type SharingChoice,
  type SharingState,
} from "@/lib/account/account-sharing";
import type {
  AccountMemberAccess,
  AccountShareMember,
  AccountSharesResponse,
} from "@/lib/api/account/useAccountShares";

import { Label } from "../ui/Label";
import { Spinner } from "../ui/Spinner";
import { Switch } from "../ui/switch";

const CHOICE_LABEL = {
  hidden: "accountSharing.hidden",
  read: "accountSharing.can-view",
  write: "accountSharing.can-edit",
} as const satisfies Record<SharingChoice, string>;

const ACCESS_LABEL = {
  ...CHOICE_LABEL,
  owner: "accountSharing.owner",
} as const satisfies Record<AccountMemberAccess, string>;

/**
 * Who in the household sees the account and who can change it: one row per member, the
 * account owner first as "Owner", every other member Hidden, Can view or Can edit (a viewer
 * only the first two). Editable only for the account owner or the household owner
 * (`canManage`); anyone else sees the same list without the controls.
 */
export function AccountSharingField({
  shares,
  isLoading,
  isError,
  state,
  onChange,
  disabled,
}: {
  shares: AccountSharesResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  /** The control's state; null until `shares` has loaded. */
  state: SharingState | null;
  onChange: (state: SharingState) => void;
  disabled?: boolean;
}) {
  const t = useTranslations();

  const memberName = (member: AccountShareMember) =>
    [member.firstName, member.lastName]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ") || t("accountSharing.unnamed-member");

  const body = () => {
    if (isLoading) {
      return (
        <div className="flex h-16 items-center justify-center">
          <Spinner size="small" />
        </div>
      );
    }
    if (isError || !shares || !state) {
      return (
        <p className="text-muted-foreground text-sm">
          {t("accountSharing.load-error")}
        </p>
      );
    }

    const editable = shares.canManage && !disabled;
    const others = shareableMembers(shares.members);

    // Nobody to share with: the plain private switch, and a word on why there is no list.
    if (others.length === 0 && shares.canManage) {
      return (
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="account-private">{t("private-account")}</Label>
              <p className="text-muted-foreground text-xs">
                {t("private-account-description")}
              </p>
            </div>
            <Switch
              id="account-private"
              checked={state.isPrivate}
              disabled={!editable}
              onCheckedChange={(isPrivate) => onChange({ ...state, isPrivate })}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {t("accountSharing.nobody-yet")}
          </p>
        </div>
      );
    }

    const owners = shares.members.filter((member) => member.isAccountOwner);

    return (
      <div className="flex flex-col gap-3">
        <ul className="divide-border divide-y">
          {[...owners, ...others].map((member) => {
            const name = memberName(member);
            const selectId = `account-share-${member.appuserKey}`;
            return (
              <li
                key={member.appuserKey}
                className="flex min-h-14 items-center justify-between gap-4 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  {editable && !member.isAccountOwner ? (
                    <label
                      htmlFor={selectId}
                      className="text-foreground truncate text-sm font-medium"
                    >
                      {name}
                    </label>
                  ) : (
                    <span className="text-foreground truncate text-sm font-medium">
                      {name}
                    </span>
                  )}
                  {/* The household role, which caps what a member can get. The account
                      owner's row says Owner on its right instead. */}
                  {member.isAccountOwner ? null : (
                    <span className="text-muted-foreground truncate text-xs">
                      {t(`household.roles.${member.role}`)}
                    </span>
                  )}
                </div>
                {member.isAccountOwner ? (
                  <span className="text-muted-foreground shrink-0 text-sm">
                    {t("accountSharing.owner")}
                  </span>
                ) : editable ? (
                  <select
                    id={selectId}
                    aria-label={t("accountSharing.access-label", { name })}
                    className="border-input bg-background text-foreground hover:border-ring/40 focus-visible:ring-ring h-11 w-36 shrink-0 rounded-md border px-3 text-sm transition-[border-color] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden sm:h-10"
                    value={state.choices[member.appuserKey] ?? "hidden"}
                    onChange={(event) =>
                      onChange({
                        ...state,
                        choices: {
                          ...state.choices,
                          [member.appuserKey]: event.target
                            .value as SharingChoice,
                        },
                      })
                    }
                  >
                    {choicesFor(member).map((choice) => (
                      <option key={choice} value={choice}>
                        {t(CHOICE_LABEL[choice])}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-foreground shrink-0 text-sm">
                    {t(ACCESS_LABEL[member.access])}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground text-xs">
          {shares.canManage
            ? t("accountSharing.later-members")
            : t("accountSharing.manager-only")}
        </p>
      </div>
    );
  };

  return (
    <section
      aria-labelledby="account-sharing-heading"
      className="border-border mt-8 border-t pt-6"
    >
      <div className="mb-3 space-y-1">
        <h3
          id="account-sharing-heading"
          className="text-foreground text-sm font-medium"
        >
          {t("accountSharing.title")}
        </h3>
        <p className="text-muted-foreground text-xs">
          {t("accountSharing.description")}
        </p>
      </div>
      {body()}
    </section>
  );
}
