"use client";

import { useTranslations } from "next-intl";

import useUserData from "@/lib/api/user/useUserData";
import { useUser } from "@/lib/auth/user-context";

import { Input } from "../ui/input";
import { Heading } from "../ui/Typography";

/**
 * Profile settings.
 *
 * Was a Tailwind UI template stub that never got adapted: `py-16` of vertical
 * padding around a single read-only field, an `h2` (text-3xl) that rendered
 * larger than the page's own "Settings" `h1`, a third nested card around one
 * input, and ~60 lines of commented-out template markup for fields that do not
 * exist. Rebuilt to DESIGN.md § 4 spacing and § 9 density — the content starts
 * immediately instead of being announced.
 */
export default function Profile() {
  const t = useTranslations();
  const user = useUser();
  const { data: userData } = useUserData(user?.id, { enabled: !!user?.id });

  return (
    <div className="flex max-w-2xl flex-col gap-4 py-6">
      {/* h3, not h2: "Settings" is the page h1 and a section inside a tab panel
          must not out-rank it. */}
      <Heading variant="h3">{t("personal-information")}</Heading>

      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm leading-6 font-medium">
          {t("email-address")}
        </label>
        <Input
          autoComplete="email"
          defaultValue={userData?.emailAddress}
          id="email"
          name="email"
          readOnly
          type="email"
        />
      </div>
    </div>
  );
}
