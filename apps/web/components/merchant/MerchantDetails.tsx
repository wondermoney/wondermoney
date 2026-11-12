"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Input } from "@/components/ui/input";
import { PropertyList } from "@/components/ui/InspectorDrawer";
import useEditTransactionMerchant from "@/lib/api/account/useEditTransactionMerchant";
import type { TransactionMerchant } from "@/lib/api/account/useTransactionMerchants";
import {
  API_ERROR_CODE,
  getApiErrorCode,
  isDemoReadOnlyError,
} from "@/lib/api/errors";
import {
  createMerchantDetailsSchema,
  merchantDetailsPatch,
  type MerchantDetailsValues,
} from "@/lib/merchant/merchant-details-schema";

interface MerchantDetailsProps {
  merchant: TransactionMerchant;
  /** The saved merchant, so a caller holding a snapshot of the row can show it at once. */
  onSaved?: (merchant: TransactionMerchant) => void;
}

/**
 * The inspector's merchant section: its website and logo, and a form to change them. The form
 * opens in place, under the facts it edits, rather than in a second dialog over the drawer.
 */
export function MerchantDetails({ merchant, onSaved }: MerchantDetailsProps) {
  const t = useTranslations("transactionMerchant");
  const [editing, setEditing] = useState(false);
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="border-border mt-2 border-t pt-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-muted-foreground text-sm">
          {t("section-title")}
        </h3>
        {!editing ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" aria-hidden />
            {t("edit")}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <MerchantDetailsForm
          merchant={merchant}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            onSaved?.(saved);
          }}
        />
      ) : (
        <PropertyList
          items={[
            {
              key: "website",
              label: t("website"),
              value: merchant.website ? (
                <span className="break-all">{merchant.website}</span>
              ) : (
                "—"
              ),
            },
            {
              key: "logo",
              label: t("logo"),
              value: merchant.logoUrl ? t("logo-custom") : "—",
            },
          ]}
        />
      )}
    </section>
  );
}

interface MerchantDetailsFormProps {
  merchant: TransactionMerchant;
  onCancel: () => void;
  onSaved: (merchant: TransactionMerchant) => void;
}

export function MerchantDetailsForm({
  merchant,
  onCancel,
  onSaved,
}: MerchantDetailsFormProps) {
  const t = useTranslations("transactionMerchant");
  const tCommon = useTranslations();
  const editMerchant = useEditTransactionMerchant();
  const schema = useMemo(
    () => createMerchantDetailsSchema((key) => t(key)),
    [t],
  );
  const form = useForm<MerchantDetailsValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      website: merchant.website ?? "",
      logoUrl: merchant.logoUrl ?? "",
    },
  });
  const serverError = form.formState.errors.root?.server?.message;

  const onSubmit = async (values: MerchantDetailsValues) => {
    form.clearErrors("root.server");
    try {
      const { transactionMerchant } = await editMerchant.mutateAsync({
        transactionMerchantKey: merchant.transactionMerchantKey,
        ...merchantDetailsPatch(values),
      });
      toast.success(t("saved"));
      onSaved(transactionMerchant);
    } catch (error) {
      form.setError("root.server", { message: saveErrorMessage(error) });
    }
  };

  const saveErrorMessage = (error: unknown): string => {
    if (isDemoReadOnlyError(error)) {
      return tCommon("demo-read-only-description");
    }
    const code = getApiErrorCode(error);
    // The API's request validation answers 400 `bad_request`; a 422 says the same thing.
    if (
      code === API_ERROR_CODE.BAD_REQUEST ||
      code === API_ERROR_CODE.VALIDATION_FAILED
    ) {
      return t("error-rejected");
    }
    if (code === API_ERROR_CODE.NOT_FOUND) return t("error-not-editable");
    return t("error-save-failed");
  };

  return (
    <Form {...form}>
      <form
        noValidate
        className="space-y-4 pt-2"
        onSubmit={form.handleSubmit(onSubmit)}
      >
        <FormField
          control={form.control}
          name="website"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("website")}</FormLabel>
              <FormControl>
                <Input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  placeholder="https://"
                  {...field}
                />
              </FormControl>
              <FormDescription>{t("website-description")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="logoUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("logo-url")}</FormLabel>
              <FormControl>
                <Input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  placeholder="https://"
                  {...field}
                />
              </FormControl>
              <FormDescription>{t("logo-url-description")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {serverError ? (
          <p role="alert" className="text-destructive-text text-sm">
            {serverError}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onCancel}
            disabled={form.formState.isSubmitting}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="submit"
            size="sm"
            loading={form.formState.isSubmitting}
            disabled={form.formState.isSubmitting}
          >
            {tCommon("save")}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default MerchantDetails;
