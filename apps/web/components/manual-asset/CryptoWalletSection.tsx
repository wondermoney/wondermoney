"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Section } from "@/components/ui/RuledSection";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import type {
  CryptoChain,
  CryptoWalletAddressDto,
  CryptoWalletDto,
  CryptoWalletTokenDto,
  ManualAsset,
} from "@/lib/api/manual-asset/types";
import {
  useAddWalletAddress,
  useRemoveWalletAddress,
  useSetWalletTokenTracked,
  useUpdateWalletAddressLabel,
} from "@/lib/api/manual-asset/useCryptoWalletMutations";
import {
  shortAddress,
  walletErrorKey,
} from "@/lib/manual-assets/crypto-wallet";
import { useFormatQuantity } from "@/lib/privacy/useFormatQuantity";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

import ConfirmAssetAction from "./ConfirmAssetAction";
import {
  rejectWalletSecrets,
  WalletAddressRow,
  walletAddressSchema,
  WalletPublicOnlyNotice,
} from "./WalletAddressRow";

const ADD_FORM_ID = "wallet-address-form";
const LABEL_FORM_ID = "wallet-label-form";

/** Reports a failed wallet change in the reader's language, never with a value it was sent. */
function useFail() {
  const t = useTranslations("assets");
  const tCommon = useTranslations();
  return (error: unknown) => {
    if (isDemoReadOnlyError(error)) {
      toast.error(tCommon("demo-read-only-title"), {
        description: tCommon("demo-read-only-description"),
        duration: 9000,
      });
      return;
    }
    const key = walletErrorKey(error);
    toast.error(
      key
        ? t(`wallet.errors.${key}`)
        : (getApiErrorMessage(error) ?? tCommon("server-error")),
    );
  };
}

function AddressStatus({ address }: { address: CryptoWalletAddressDto }) {
  const t = useTranslations("assets");
  const formatShortDate = useFormatShortDate();
  const when = (iso: string) =>
    formatShortDate(iso, { alwaysShowYear: true, withTime: true });

  if (address.status === "pending")
    return (
      <p className="text-muted-foreground text-sm">
        {t("wallet.status.pending")}
      </p>
    );
  if (address.status === "ok")
    return (
      <p className="text-muted-foreground text-sm">
        {address.lastSyncedAt
          ? t("wallet.status.ok", { date: when(address.lastSyncedAt) })
          : t("wallet.status.okNoDate")}
      </p>
    );
  return (
    <p className="text-warning-text text-sm">
      {t("wallet.status.failed", {
        reason: t(`wallet.failure.${address.errorCode ?? "unavailable"}`),
      })}
      {address.lastSyncedAt
        ? ` ${t("wallet.status.balancesFrom", { date: when(address.lastSyncedAt) })}`
        : ""}
    </p>
  );
}

function TokenRow({
  token,
  onTrackedChange,
  busy,
}: {
  token: CryptoWalletTokenDto;
  onTrackedChange: (tracked: boolean) => void;
  busy: boolean;
}) {
  const t = useTranslations("assets");
  const formatQuantity = useFormatQuantity();
  const id = `wallet-token-${token.cryptoWalletTokenKey}`;

  return (
    <li className="flex items-center justify-between gap-4 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        <Checkbox
          id={id}
          checked={token.tracked}
          disabled={busy}
          onCheckedChange={(checked) => onTrackedChange(checked === true)}
          aria-label={t("wallet.tokens.count", { symbol: token.symbol })}
        />
        <label htmlFor={id} className="min-w-0 cursor-pointer">
          <span className="text-foreground font-mono font-medium">
            {token.symbol}
          </span>
          {token.name ? (
            <span className="text-muted-foreground ml-2 truncate">
              {token.name}
            </span>
          ) : null}
        </label>
        {token.priceMissing ? (
          <Badge variant="warning">{t("wallet.tokens.noPrice")}</Badge>
        ) : null}
      </div>
      <span className="text-foreground shrink-0 font-mono tabular-nums">
        {formatQuantity(token.quantity)}
      </span>
    </li>
  );
}

/** Add one address to a wallet, behind the same check for secrets as the wallet form. */
function AddAddressDrawer({
  open,
  onOpenChange,
  manualAssetId,
  chains,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manualAssetId: number;
  chains: CryptoChain[];
}) {
  const t = useTranslations("assets");
  const fail = useFail();
  const addMutation = useAddWalletAddress();
  const schema = useMemo(
    () =>
      z.object({
        addresses: z.array(walletAddressSchema(t, chains)).length(1),
      }),
    [t, chains],
  );
  const defaultValues = useMemo(
    () => ({ addresses: [{ chain: chains[0], address: "", label: "" }] }),
    [chains],
  );
  const form = useForm<
    z.input<typeof schema>,
    undefined,
    z.output<typeof schema>
  >({ resolver: zodResolver(schema), defaultValues });
  useEffect(() => {
    if (open) form.reset(defaultValues);
  }, [open, defaultValues, form]);

  const clearSecret = () => {
    form.setValue("addresses.0.address", "", { shouldDirty: true });
    form.setError("addresses.0.address", {
      type: "secret",
      message: t("wallet.errors.secretBlocked"),
    });
  };

  const submit = async ({ addresses: [row] }: z.output<typeof schema>) => {
    try {
      await addMutation.mutateAsync({
        manualAssetId,
        payload: {
          chain: row.chain,
          address: row.address,
          label: row.label || null,
        },
      });
      onOpenChange(false);
    } catch (error) {
      const key = walletErrorKey(error);
      if (key === "secretRejected") {
        clearSecret();
        return;
      }
      if (key === "addressInvalid" || key === "addressExists") {
        form.setError("addresses.0.address", {
          type: "server",
          message: t(`wallet.errors.${key}`),
        });
        return;
      }
      fail(error);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (rejectWalletSecrets(form.getValues("addresses"), clearSecret)) {
      form.setFocus("addresses.0.address");
      return;
    }
    void form.handleSubmit(submit)(event);
  };

  return (
    <DrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("wallet.actions.addAddress")}
      footer={
        <Button
          form={ADD_FORM_ID}
          type="submit"
          loading={addMutation.isPending}
        >
          {t("wallet.actions.addAddress")}
        </Button>
      }
    >
      <Form {...form}>
        <FormContent id={ADD_FORM_ID} onSubmit={onSubmit}>
          <WalletPublicOnlyNotice />
          <WalletAddressRow index={0} chains={chains} showHeading={false} />
        </FormContent>
      </Form>
    </DrawerDialog>
  );
}

function EditLabelDrawer({
  address,
  manualAssetId,
  onClose,
}: {
  address: CryptoWalletAddressDto | null;
  manualAssetId: number;
  onClose: () => void;
}) {
  const t = useTranslations("assets");
  const fail = useFail();
  const updateMutation = useUpdateWalletAddressLabel();
  const schema = useMemo(
    () =>
      z.object({
        label: z.string().trim().max(100, t("wallet.validation.labelTooLong")),
      }),
    [t],
  );
  const form = useForm<
    z.input<typeof schema>,
    undefined,
    z.output<typeof schema>
  >({ resolver: zodResolver(schema), defaultValues: { label: "" } });
  useEffect(() => {
    if (address) form.reset({ label: address.label ?? "" });
  }, [address, form]);

  const submit = async ({ label }: z.output<typeof schema>) => {
    if (!address) return;
    try {
      await updateMutation.mutateAsync({
        manualAssetId,
        addressId: address.cryptoWalletAddressKey,
        label: label || null,
      });
      onClose();
    } catch (error) {
      fail(error);
    }
  };

  return (
    <DrawerDialog
      open={address !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("wallet.actions.editLabel")}
      footer={
        <Button
          form={LABEL_FORM_ID}
          type="submit"
          loading={updateMutation.isPending}
        >
          {t("actions.save")}
        </Button>
      }
    >
      <Form {...form}>
        <FormContent id={LABEL_FORM_ID} onSubmit={form.handleSubmit(submit)}>
          {address ? (
            <p className="text-muted-foreground font-mono text-sm break-all">
              {address.address}
            </p>
          ) : null}
          <FormField
            control={form.control}
            name="label"
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
        </FormContent>
      </Form>
    </DrawerDialog>
  );
}

/**
 * A crypto wallet's addresses, what was last read on each, and which of its
 * tokens count. The value is the ticked tokens' balances at their prices, so
 * the reader decides here what is counted rather than typing a value.
 */
export default function CryptoWalletSection({
  asset,
  wallet,
  chains,
}: {
  asset: ManualAsset;
  wallet: CryptoWalletDto;
  /** The chains new addresses can be added on; empty hides "Add address". */
  chains: CryptoChain[];
}) {
  const t = useTranslations("assets");
  const fail = useFail();
  const trackMutation = useSetWalletTokenTracked();
  const removeMutation = useRemoveWalletAddress();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<CryptoWalletAddressDto | null>(null);
  const [removing, setRemoving] = useState<CryptoWalletAddressDto | null>(null);
  const manualAssetId = asset.manualAssetKey;

  const setTracked = async (token: CryptoWalletTokenDto, tracked: boolean) => {
    try {
      await trackMutation.mutateAsync({
        manualAssetId,
        tokenId: token.cryptoWalletTokenKey,
        tracked,
      });
    } catch (error) {
      fail(error);
    }
  };

  const removeAddress = async (address: CryptoWalletAddressDto) => {
    try {
      await removeMutation.mutateAsync({
        manualAssetId,
        addressId: address.cryptoWalletAddressKey,
      });
    } catch (error) {
      fail(error);
    }
  };

  const canRemove = wallet.addresses.length > 1;

  return (
    <Section id="asset-wallet-heading" title={t("wallet.detail.title")}>
      <div className="flex flex-col gap-6">
        <p className="text-muted-foreground max-w-prose text-sm">
          {t("wallet.detail.howItWorks")}
        </p>
        {wallet.unpricedSymbols.length > 0 ? (
          <p role="note" className="text-warning-text text-sm">
            {t("wallet.detail.unpriced", {
              symbols: wallet.unpricedSymbols.join(", "),
            })}
          </p>
        ) : null}

        <ul className="divide-border border-border divide-y border-y">
          {wallet.addresses.map((address) => {
            const title = address.label ?? t(`wallet.chains.${address.chain}`);
            return (
              <li
                key={address.cryptoWalletAddressKey}
                aria-label={title}
                className="flex flex-col gap-3 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-foreground font-medium">
                        {title}
                      </span>
                      <Badge variant="muted">
                        {t(`wallet.chains.${address.chain}`)}
                      </Badge>
                      <Badge variant="outline">
                        {t(`wallet.addressKinds.${address.kind}`)}
                      </Badge>
                    </div>
                    <p
                      className="text-muted-foreground font-mono text-xs"
                      title={address.address}
                    >
                      <span aria-hidden="true">
                        {shortAddress(address.address)}
                      </span>
                      <span className="sr-only">{address.address}</span>
                    </p>
                    <AddressStatus address={address} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(address)}
                      aria-label={t("wallet.actions.editLabelOf", { title })}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                      {t("wallet.actions.editLabel")}
                    </Button>
                    {canRemove ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRemoving(address)}
                        aria-label={t("wallet.actions.removeAddressOf", {
                          title,
                        })}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                        {t("wallet.actions.removeAddress")}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {address.tokens.length > 0 ? (
                  <ul
                    aria-label={t("wallet.tokens.title")}
                    className="divide-border divide-y"
                  >
                    {address.tokens.map((token) => (
                      <TokenRow
                        key={token.cryptoWalletTokenKey}
                        token={token}
                        busy={trackMutation.isPending}
                        onTrackedChange={(tracked) =>
                          void setTracked(token, tracked)
                        }
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {t("wallet.tokens.none")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {chains.length > 0 && (
          <div>
            <Button variant="secondary" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t("wallet.actions.addAddress")}
            </Button>
          </div>
        )}
      </div>

      {chains.length > 0 && (
        <AddAddressDrawer
          open={addOpen}
          onOpenChange={setAddOpen}
          manualAssetId={manualAssetId}
          chains={chains}
        />
      )}
      <EditLabelDrawer
        address={editing}
        manualAssetId={manualAssetId}
        onClose={() => setEditing(null)}
      />
      <ConfirmAssetAction
        title={removing ? t("wallet.removeAddressTitle") : null}
        description={t("wallet.removeAddressConfirm")}
        confirmLabel={t("wallet.actions.removeAddress")}
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const confirmed = removing;
          setRemoving(null);
          if (confirmed) void removeAddress(confirmed);
        }}
      />
    </Section>
  );
}
