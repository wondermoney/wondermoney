"use client";

import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * The authenticator code a change to the Enable Banking key asks for when two-factor is on. The
 * caller keeps it in component state only and clears it after every attempt.
 */
export default function AuthenticatorCodeField({ id, value, onChange }: Props) {
  const t = useTranslations("bankProvider.generated");
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t("totp")}</Label>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        value={value}
        maxLength={6}
        className="font-mono sm:max-w-40"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
