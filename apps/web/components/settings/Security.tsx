"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth/client";
import { useUser } from "@/lib/auth/user-context";

import { Button } from "../ui/button";
import { Heading, Text } from "../ui/Typography";
import UserAccountDelete from "../user/UserAccountDelete";
import TwoFactorAuth from "./Security/2FA";
import ChangePasswordForm from "./Security/ChangePasswordForm";

export default function Security() {
  const t = useTranslations();
  const user = useUser();

  // RAD-293: better-auth's session user has no `app_metadata` OAuth provider
  // field like Supabase did. Whether the change-password section makes
  // sense is really gated by "does this user have a credential (email +
  // password) account", not by whether Google happens to be linked too — a
  // user can have both. Default to `true` (show the section) until the
  // linked accounts load, and on any lookup error: the safe failure mode is
  // an unused form for OAuth-only accounts, not hiding password management
  // from an account that has one.
  const [hasPasswordAccount, setHasPasswordAccount] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadAccounts() {
      const { data, error } = await authClient.listAccounts();
      if (cancelled || error || !data) return;
      setHasPasswordAccount(
        data.some((account) => account.providerId === "credential"),
      );
    }

    void loadAccounts();

    return () => {
      cancelled = true;
    };
  }, []);

  const [isDeleteUserAccountModalOpen, setIsDeleteUserAccountModalOpen] =
    useState(false);

  return (
    <div className="divide-y divide-white/5">
      {user && hasPasswordAccount && (
        <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8">
          <div>
            <Heading variant="h2">{t("change-password")}</Heading>
            <Text variant="lead" className="mt-1 text-sm">
              {t("security-password-description")}
            </Text>
          </div>

          <ChangePasswordForm className="rounded bg-white p-4 md:col-span-2" />
        </div>
      )}

      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8">
        <div>
          <Heading variant="h2">{t("mfa-title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("mfa-description")}
          </Text>
        </div>

        <TwoFactorAuth />
      </div>

      {/* <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8">
        <div>
          <Heading variant="h2" className="text-base font-semibold leading-7 ">
            Log out other sessions
          </Heading>
          <Text variant="lead" className="mt-1 text-sm">
            Please enter your password to confirm you would like to log out of
            your other sessions across all of your devices.
          </Text>
        </div>

        <form className="md:col-span-2">
          <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:max-w-xl sm:grid-cols-6">
            <div className="col-span-full">
              <label
                htmlFor="logout-password"
                className="block text-sm font-medium leading-6 "
              >
                Your password
              </label>
              <div className="mt-2">
                <Input
                  id="logout-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  className="block w-full rounded-md border-0 bg-white/5 py-1.5  shadow-xs ring-1 ring-inset ring-white/10 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm sm:leading-6"
                />
              </div>
            </div>
          </div>

          <div className="mt-8 flex">
            <Button>{t("log-out-other-sessions")}</Button>
          </div>
        </form>
      </div> */}

      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8">
        <div>
          <Heading variant="h2">{t("delete-wondermoney-account")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("delete-wondermoney-account-description")}
          </Text>
        </div>

        <div className="flex items-start md:col-span-2">
          <Button
            type="button"
            variant="destructive"
            onClick={() => setIsDeleteUserAccountModalOpen(true)}
          >
            {t("delete-wondermoney-account")}
          </Button>
          <UserAccountDelete
            isOpen={isDeleteUserAccountModalOpen}
            closeModal={() => setIsDeleteUserAccountModalOpen(false)}
          />
        </div>
      </div>
    </div>
  );
}
