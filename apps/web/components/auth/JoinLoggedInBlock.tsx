"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { authClient } from "@/lib/auth/client";

import { Button } from "../ui/button";

/**
 * On /join while signed in: signs out and returns to the same invite link, so
 * the visitor can sign in with (or create) the invited account instead.
 */
export function JoinLoggedInBlock({
  token,
  variant = "secondary",
}: {
  token?: string;
  variant?: "default" | "secondary";
}) {
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
    <Button
      variant={variant}
      className="w-full font-semibold"
      loading={pending}
      disabled={pending}
      onClick={logoutAndJoin}
    >
      {t("join.useDifferentAccount")}
    </Button>
  );
}
