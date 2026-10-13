"use client";

import { Moon, Sun } from "lucide-react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useState, useTransition } from "react";

import { usePathname } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import useUserData from "@/lib/api/user/useUserData";
import { useUser } from "@/lib/auth/user-context";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";
import { Heading, Text } from "../ui/Typography";

export default function Appearance() {
  const user = useUser();
  const { theme, setTheme } = useTheme();
  const { data: userData } = useUserData(user?.id, { enabled: !!user?.id });
  const [mounted, setMounted] = useState(false);
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const params = useParams();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  function onLocaleChange(newLocale: string) {
    startTransition(() => {
      router.replace(
        // @ts-expect-error -- TypeScript will validate that only known `params`
        // are used in combination with a given `pathname`. Since the two will
        // always match for the current route, we can skip runtime checks.
        { pathname, params },
        { locale: newLocale },
      );
    });
  }

  return (
    <div className="divide-border divide-y">
      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8">
        <div>
          <Heading variant="h2">{t("appearance-title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("appearance-description")}
          </Text>
        </div>

        <div className="bg-card rounded p-4 md:col-span-2">
          <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:max-w-xl sm:grid-cols-6">
            <div className="col-span-full">
              <label className="block text-sm leading-6 font-medium">
                {t("theme")}
              </label>
              <div className="mt-2">
                <Select value={theme} onValueChange={setTheme}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a theme" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">
                      <div className="flex flex-row items-center gap-2">
                        <Sun className="size-4" />
                        {t("light")}
                      </div>
                    </SelectItem>
                    <SelectItem value="dark">
                      <div className="flex flex-row items-center gap-2">
                        <Moon className="size-4" />
                        {t("dark")}
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="col-span-full">
              <label className="block text-sm leading-6 font-medium">
                {t("language")}
              </label>
              <div className="mt-2">
                <Select
                  defaultValue={locale}
                  onValueChange={onLocaleChange}
                  disabled={isPending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a language" />
                  </SelectTrigger>
                  <SelectContent>
                    {routing.locales.map((cur) => (
                      <SelectItem key={cur} value={cur}>
                        {t("locale", { locale: cur })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
