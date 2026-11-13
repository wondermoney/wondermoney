"use client";

import { ShieldAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFormContext, useWatch } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { CRYPTO_CHAINS, type CryptoChain } from "@/lib/api/manual-asset/types";
import { looksLikeWalletSecret } from "@/lib/manual-assets/crypto-wallet";

export interface WalletAddressInput {
  chain: CryptoChain;
  address: string;
  label: string;
}

/** A form that holds wallet address rows under `addresses`. */
interface WalletAddressesValues {
  addresses: WalletAddressInput[];
}

/** One address row, limited to the chains the server has an explorer for. */
export function walletAddressSchema(
  t: (key: string) => string,
  chains: readonly CryptoChain[],
) {
  return z.object({
    chain: z
      .enum(CRYPTO_CHAINS)
      .refine((chain) => chains.includes(chain), t("validation.required")),
    address: z
      .string()
      .trim()
      .min(1, t("validation.required"))
      .max(200, t("wallet.errors.addressInvalid")),
    label: z.string().trim().max(100, t("wallet.validation.labelTooLong")),
  });
}

/**
 * The rows that hold a private key or a recovery phrase, each handed to
 * `reject` (which clears it). True when any did: the form must not be sent.
 * The value is never read back, logged or put in a message.
 */
export function rejectWalletSecrets(
  addresses: readonly { address: string }[],
  reject: (index: number) => void,
): boolean {
  let found = false;
  addresses.forEach(({ address }, index) => {
    if (looksLikeWalletSecret(address) === null) return;
    found = true;
    reject(index);
  });
  return found;
}

/** Said plainly wherever an address is typed. */
export function WalletPublicOnlyNotice() {
  const t = useTranslations("assets");
  return (
    <div className="flex gap-3 text-sm" role="note">
      <ShieldAlert
        className="text-muted-foreground mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="text-foreground font-medium">
          {t("wallet.publicOnly.title")}
        </p>
        <p className="text-muted-foreground">{t("wallet.publicOnly.body")}</p>
      </div>
    </div>
  );
}

/**
 * The chain, the address and an optional label for one address of a wallet,
 * inside a form whose rows live under `addresses`.
 */
export function WalletAddressRow({
  index,
  chains,
  onRemove,
  showHeading,
}: {
  index: number;
  chains: readonly CryptoChain[];
  /** Absent when the row cannot be removed (the only one). */
  onRemove?: () => void;
  showHeading: boolean;
}) {
  const t = useTranslations("assets");
  const form = useFormContext<WalletAddressesValues>();
  const chain = useWatch({
    control: form.control,
    name: `addresses.${index}.chain`,
  });
  const heading = t("wallet.fields.addressNumber", { number: index + 1 });

  return (
    <fieldset className="flex flex-col gap-4" aria-label={heading}>
      {showHeading || onRemove ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-foreground text-sm font-medium">{heading}</span>
          {onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              aria-label={t("wallet.actions.removeRow", { number: index + 1 })}
            >
              <X className="size-4" aria-hidden="true" />
              {t("wallet.actions.removeRowShort")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <FormField
        control={form.control}
        name={`addresses.${index}.chain`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("wallet.fields.chain")}</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {chains.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`wallet.chains.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`addresses.${index}.address`}
        render={({ field }) => (
          <FormItem>
            <FormLabel required>
              {chain === "bitcoin"
                ? t("wallet.fields.addressOrXpub")
                : t("wallet.fields.address")}
            </FormLabel>
            <FormControl>
              {/* Never remembered or corrected by the browser: a mistaken
                  paste of a secret must not end up in its form history. */}
              <Input
                {...field}
                className="font-mono"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                placeholder={t(`wallet.fields.addressPlaceholder.${chain}`)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`addresses.${index}.label`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("wallet.fields.label")}</FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder={t("wallet.fields.labelPlaceholder")}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </fieldset>
  );
}
