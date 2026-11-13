"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useMemo } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import {
  Form,
  FormContent,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  getApiErrorMessage,
  getCryptoWalletAddressIndex,
  isDemoReadOnlyError,
} from "@/lib/api/errors";
import type { CryptoChain, ManualAsset } from "@/lib/api/manual-asset/types";
import { useCreateCryptoWallet } from "@/lib/api/manual-asset/useCryptoWalletMutations";
import { walletErrorKey } from "@/lib/manual-assets/crypto-wallet";

import {
  rejectWalletSecrets,
  WalletAddressRow,
  walletAddressSchema,
  WalletPublicOnlyNotice,
} from "./WalletAddressRow";

const FORM_ID = "crypto-wallet-form";
/** The most addresses one wallet takes. */
const MAX_ADDRESSES = 20;

function buildSchema(t: (key: string) => string, chains: CryptoChain[]) {
  return z.object({
    name: z.string().trim().min(1, t("validation.required")).max(255),
    isPrivate: z.boolean(),
    notes: z.string().max(10_000).optional(),
    addresses: z
      .array(walletAddressSchema(t, chains))
      .min(1)
      .max(MAX_ADDRESSES),
  });
}

type FormInput = z.input<ReturnType<typeof buildSchema>>;
type FormValues = z.output<ReturnType<typeof buildSchema>>;

/**
 * Add a crypto wallet from its public addresses. Its value comes from the
 * balances the server reads, in US dollars, so there is no value, currency or
 * date to ask for. A private key or a recovery phrase is refused here before
 * anything is sent, and cleared from the field.
 */
export default function CryptoWalletFormDrawer({
  open,
  onOpenChange,
  chains,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chains the server can read; never empty when the drawer is offered. */
  chains: CryptoChain[];
  onCreated?: (asset: ManualAsset) => void;
}) {
  const t = useTranslations("assets");
  const tCommon = useTranslations();
  const createMutation = useCreateCryptoWallet();

  const emptyRow = useMemo(
    () => ({ chain: chains[0], address: "", label: "" }),
    [chains],
  );
  const defaultValues = useMemo<FormInput>(
    () => ({ name: "", isPrivate: false, notes: "", addresses: [emptyRow] }),
    [emptyRow],
  );
  const schema = useMemo(() => buildSchema(t, chains), [t, chains]);
  const form = useForm<FormInput, undefined, FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  const rows = useFieldArray({ control: form.control, name: "addresses" });
  useEffect(() => {
    if (open) form.reset(defaultValues);
  }, [open, defaultValues, form]);

  const secretMessage = t("wallet.errors.secretBlocked");
  const clearSecret = (index: number) => {
    form.setValue(`addresses.${index}.address`, "", { shouldDirty: true });
    form.setError(`addresses.${index}.address`, {
      type: "secret",
      message: secretMessage,
    });
  };

  const submit = async (values: FormValues) => {
    try {
      const { asset } = await createMutation.mutateAsync({
        name: values.name,
        isPrivate: values.isPrivate,
        notes: values.notes?.trim() ? values.notes : null,
        addresses: values.addresses.map(({ chain, address, label }) => ({
          chain,
          address,
          label: label || null,
        })),
      });
      onCreated?.(asset);
      onOpenChange(false);
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(tCommon("demo-read-only-title"), {
          description: tCommon("demo-read-only-description"),
          duration: 9000,
        });
        return;
      }
      const key = walletErrorKey(error);
      const index = getCryptoWalletAddressIndex(error);
      if (key === "secretRejected") {
        // The server's check is wider than this one (it knows the word list).
        // Clear the address it names, or every address when it names none.
        if (index !== undefined && index < values.addresses.length)
          clearSecret(index);
        else values.addresses.forEach((_row, row) => clearSecret(row));
        return;
      }
      if (
        (key === "addressInvalid" || key === "addressExists") &&
        index !== undefined &&
        index < values.addresses.length
      ) {
        form.setError(`addresses.${index}.address`, {
          type: "server",
          message: t(`wallet.errors.${key}`),
        });
        return;
      }
      toast.error(
        key
          ? t(`wallet.errors.${key}`)
          : (getApiErrorMessage(error) ?? tCommon("server-error")),
      );
    }
  };

  // Secrets are looked for before validation, so a refused value is gone from
  // the field before anything else happens, and never reaches the request.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rejected: number[] = [];
    const found = rejectWalletSecrets(form.getValues("addresses"), (index) => {
      rejected.push(index);
      clearSecret(index);
    });
    if (found) {
      form.setFocus(`addresses.${rejected[0]}.address`);
      return;
    }
    void form.handleSubmit(submit)(event);
  };

  return (
    <DrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("wallet.addTitle")}
      footer={
        <Button form={FORM_ID} type="submit" loading={createMutation.isPending}>
          {t("wallet.actions.add")}
        </Button>
      }
    >
      <Form {...form}>
        <FormContent id={FORM_ID} onSubmit={onSubmit}>
          <WalletPublicOnlyNotice />
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("fields.name")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder={t("wallet.fields.namePlaceholder")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {rows.fields.map((row, index) => (
            <WalletAddressRow
              key={row.id}
              index={index}
              chains={chains}
              showHeading={rows.fields.length > 1}
              onRemove={
                rows.fields.length > 1 ? () => rows.remove(index) : undefined
              }
            />
          ))}
          {rows.fields.length < MAX_ADDRESSES && (
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => rows.append(emptyRow)}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t("wallet.actions.addRow")}
              </Button>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            {t("wallet.explorerNote")}
          </p>
          <FormField
            control={form.control}
            name="isPrivate"
            render={({ field }) => (
              <FormItem className="flex-row items-start justify-between gap-4">
                <div className="space-y-1">
                  <FormLabel className="mb-0">
                    {t("wallet.fields.private")}
                  </FormLabel>
                  <p className="text-muted-foreground text-xs">
                    {t("fields.privateDescription")}
                  </p>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.notes")}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    placeholder={t("fields.notesPlaceholder")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormContent>
      </Form>
    </DrawerDialog>
  );
}
