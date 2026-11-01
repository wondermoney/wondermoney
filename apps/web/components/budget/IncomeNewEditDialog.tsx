"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { SubmitHandler, useForm, useWatch } from "react-hook-form";
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
import { LearningTip } from "@/components/ui/learning-tip";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Switch } from "@/components/ui/switch";
import Text from "@/components/ui/Typography/Text";
import { zLocaleNumber } from "@/lib/utils/number";

const recurrencyOptions = [
  { value: "MONTHLY", label: "recurrency_monthly" },
  { value: "MONTHLY_14", label: "recurrency_monthly_14" },
  { value: "QUARTERLY", label: "recurrency_quarterly" },
  { value: "ANNUALLY", label: "recurrency_annually" },
  { value: "BI_ANNUALLY", label: "recurrency_biannually" },
];

export const schema = z
  .object({
    id: z.string(),
    name: z.string().min(1),
    amount: zLocaleNumber.pipe(z.number().min(0)),
    isRecurrent: z.boolean(),
    recurrency: z
      .enum(["MONTHLY", "MONTHLY_14", "QUARTERLY", "ANNUALLY", "BI_ANNUALLY"])
      .optional(),
  })
  .refine(
    (data) => {
      // If isRecurrent is true, recurrency should be defined
      if (data.isRecurrent) {
        return data.recurrency !== undefined;
      }
      return true;
    },
    {
      message: "Recurrency is required when isRecurrent is true",
      path: ["recurrency"], // path to error message
    },
  );

export type IncomeData = z.infer<typeof schema> & { id: string };

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  income?: IncomeData;
  onNewIncomeCreated?: (income: IncomeData) => void;
  onIncomeEdited?: (income: IncomeData) => void;
};

const IncomeNewEditDialog: React.FC<Props> = ({
  open,
  setOpen,
  income,
  onNewIncomeCreated,
  onIncomeEdited,
}) => {
  const t = useTranslations();
  const methods = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      id: "",
      name: income?.name ?? "",
      amount: income?.amount ?? 0,
      isRecurrent: income?.isRecurrent ?? true,
      recurrency: income?.recurrency ?? "ANNUALLY",
    },
  });

  const isRecurrent = useWatch({
    control: methods.control,
    name: "isRecurrent",
  });

  const onSubmit: SubmitHandler<IncomeData> = (data) => {
    if (income !== undefined) {
      onIncomeEdited?.({ ...data, id: income.id });
    } else {
      onNewIncomeCreated?.({ ...data, id: Date.now().toString() });
    }

    setOpen(false);
    methods.reset();
  };

  return (
    <DrawerDialog
      open={open}
      onOpenChange={setOpen}
      title={income ? t("edit-income-stream") : t("new-income-stream")}
      footer={
        <Button
          type="submit"
          loading={methods.formState.isSubmitting}
          form="new-income-form"
        >
          {income ? t("save") : t("add-income")}
        </Button>
      }
    >
      <Form {...methods}>
        <FormContent
          onSubmit={(event) => {
            // This dialog is portalled into `document.body` by Radix,
            // but React re-dispatches synthetic events along the
            // *component* tree, not the DOM tree — a `submit` fired here
            // still bubbles up to the wizard income step's own `<form>`,
            // even though the two elements are unrelated in the DOM.
            // Without stopping it, submitting this dialog also submits the
            // outer step: `useCreateBudget` fires immediately, using
            // whatever `incomes` the outer form happened to hold at that
            // instant rather than the value just entered here, and the
            // wizard silently advances a step no one asked it to advance.
            event.stopPropagation();
            return methods.handleSubmit(onSubmit)(event);
          }}
          id="new-income-form"
        >
          <FormField
            control={methods.control}
            name="isRecurrent"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between">
                <FormLabel required>{t("is-recurrent-income")}</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {isRecurrent && (
            <FormField
              control={methods.control}
              name="recurrency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("recurrence")}</FormLabel>
                  <LearningTip
                    tooltip={t("recurrence-tooltip")}
                    ariaLabel={t("recurrence-help-label")}
                  >
                    {t("recurrence-help")}
                  </LearningTip>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder={t("recurrence")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectGroup>
                        {recurrencyOptions.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {t(r.label)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <FormField
            control={methods.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("name")}</FormLabel>
                <FormControl>
                  <Input placeholder={t("name")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={methods.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("amount")}</FormLabel>
                <FormControl>
                  <Input
                    type="tel"
                    placeholder={t("amount")}
                    startAdornment={
                      <Text variant="mutedText" className="px-4">
                        €
                      </Text>
                    }
                    {...field}
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
};

export default IncomeNewEditDialog;
