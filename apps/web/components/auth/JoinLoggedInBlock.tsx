"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { authClient } from "@/lib/auth/client";

import { Button } from "../ui/button";

/**
 * Shown on /join when someone is already signed in. Household invites are
 * new-signups-only, so the only path forward is to log out and create a fresh
 * account with the invited email — this signs out and returns to the same
 * invite link so the signup form renders.
 */
export function JoinLoggedInBlock({ token }: { token?: string }) {
  const t = useTranslations("household");
  const [pending, setPending] = useState(false);

  const logoutAndJoin = async () => {
    setPending(true);
    await authClient.signOut();
    const target = token
      ? `${window.location.pathname}?token=${encodeURIComponent(token)}`
      : window.location.pathname;
    window.location.assign(target);
  };

  return (
    <div className="mt-6 flex flex-col gap-4">
      <Button
        className="w-full font-semibold"
        loading={pending}
        disabled={pending}
        onClick={logoutAndJoin}
      >
        {t("join.logoutAndJoin")}
      </Button>
    </div>
  );
}
