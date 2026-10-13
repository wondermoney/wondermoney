"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  Form,
  FormContent,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Label } from "@/components/ui/Label";
import { Text } from "@/components/ui/Typography";
import useCreateTransactionOcr, {
  OCR_UPLOAD_MAX_BYTES,
} from "@/lib/api/account/useCreateTransactionOcr";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { cn } from "@/lib/utils";

import { Checkbox } from "../ui/checkbox";
import { FileUploader } from "../ui/FileUploader";
import { Spinner } from "../ui/Spinner";

export interface TransactionOcrData {
  transactionDate?: Date;
  originalAmount?: string;
  originalCurrencyId?: string;
  transactionMerchantName?: string;
}

interface AccountTransactionAddModalProps {
  termsAndConditionsAccept: boolean | undefined;
  onOcrSubmitting: (submitting: boolean) => void;
  onOcrComplete: (
    transactionOcrImportId: number,
    transactionData: TransactionOcrData,
  ) => void;
}

const createFormSchema = (t: (key: string) => string) =>
  z.object({
    files: z.array(z.instanceof(File)).min(1, t("invalid-file-required")),
    termsAndConditionsAccepted: z.boolean().refine((val) => val === true, {
      message: t("invalid-terms-conditions-required"),
    }),
    savePreferences: z.boolean(),
  });

type FormSchema = z.infer<ReturnType<typeof createFormSchema>>;

const AccountTransactionOcrContent: React.FC<
  AccountTransactionAddModalProps
> = ({ termsAndConditionsAccept, onOcrSubmitting, onOcrComplete }) => {
  const t = useTranslations();
  const notifyIfRateLimited = useRateLimitToast();
  const posthog = usePostHog();
  const formSchema = useMemo(() => createFormSchema(t), [t]);
  const methods = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      files: [],
      termsAndConditionsAccepted: termsAndConditionsAccept || false,
      savePreferences: !!termsAndConditionsAccept,
    },
  });
  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = methods;

  const [isSubmitLoading, setIsSubmitLoading] = useState(false);

  const createTransactionOcrMutation = useCreateTransactionOcr();

  const onSubmit = async (data: FormSchema) => {
    setIsSubmitLoading(true);
    onOcrSubmitting(true);

    if (data.savePreferences) {
      localStorage.setItem(
        "terms_and_conditions_accept",
        data.termsAndConditionsAccepted ? "1" : "0",
      );
    } else {
      localStorage.removeItem("terms_and_conditions_accept");
    }

    posthog.capture("account_transaction_ocr", { data });

    await createTransactionOcrMutation.mutateAsync(
      { file: data.files[0] },
      {
        onSuccess: async (ocrData) => {
          const { transactionOcrImportId, transactionInfo } = ocrData.data;
          onOcrComplete(transactionOcrImportId, transactionInfo);

          setIsSubmitLoading(false);
          onOcrSubmitting(false);
          reset();
          posthog.capture("account_transaction_orc_success");
        },
        onError: (error) => {
          if (notifyIfRateLimited(error)) return;
          setIsSubmitLoading(false);
          onOcrSubmitting(false);
          toast.error(t("toast-ocr-transaction-error"), {
            duration: 9000,
          });
        },
      },
    );
  };

  if (isSubmitLoading) {
    return (
      <div className="flex size-full min-h-80 cursor-pointer flex-col items-center justify-center gap-4 overflow-auto p-4 text-center md:px-px">
        <div className="bg-secondary rounded-full p-6">
          <Spinner size="large" />
        </div>
        <Text>{t("ocr-process-ongoing")}</Text>
      </div>
    );
  }

  return (
    <Form {...methods}>
      <FormContent
        className="w-full flex-row flex-wrap gap-4 px-4 md:px-px"
        onSubmit={handleSubmit(onSubmit)}
        id="add-account-transaction-form"
      >
        <FormField
          control={control}
          name="files"
          render={({ field }) => (
            <FormItem className="basis-full">
              <FileUploader
                value={field.value}
                onValueChange={(files) => {
                  setValue(field.name, files);
                }}
                accept={{
                  "image/*": [],
                  "application/pdf": [".pdf"],
                }}
                maxFileCount={1}
                maxSize={OCR_UPLOAD_MAX_BYTES}
              />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="termsAndConditionsAccepted"
          render={({ field }) => (
            <FormItem className="w-full">
              <div className="align-center flex flex-row gap-3">
                <FormControl>
                  <Checkbox
                    id="terms-and-conditions-ocr"
                    defaultChecked={false}
                    checked={field.value}
                    className={cn({
                      "border-destructive-text":
                        errors.termsAndConditionsAccepted,
                    })}
                    onCheckedChange={(value: boolean) =>
                      setValue(field.name, value)
                    }
                  />
                </FormControl>
                <FormLabel>{t("terms-conditions")}</FormLabel>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="savePreferences"
          render={({ field }) => (
            <FormItem className="w-full flex-row gap-3">
              <FormControl>
                <Checkbox
                  id="save-preferences-ocr"
                  defaultChecked={false}
                  checked={field.value}
                  className={cn({
                    "border-destructive-text": errors.savePreferences,
                  })}
                  onCheckedChange={(value: boolean) =>
                    setValue(field.name, value)
                  }
                />
              </FormControl>
              <Label htmlFor="save-preferences-ocr">
                {t("save-preferences")}
              </Label>
            </FormItem>
          )}
        />
      </FormContent>
    </Form>
  );
};

export default AccountTransactionOcrContent;
