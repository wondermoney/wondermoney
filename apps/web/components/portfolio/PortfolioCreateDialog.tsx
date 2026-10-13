"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";
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
import { LearningTip } from "@/components/ui/learning-tip";
import useAccounts from "@/lib/api/account/useAccounts";
import useConfigs from "@/lib/api/configs/useConfigs";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import useCreatePortfolio from "@/lib/api/portfolio/useCreatePortfolio";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { getCurrencySymbol } from "@/lib/utils/currencySymbol";

import { Button } from "../ui/button";
import { DrawerDialog } from "../ui/dialog-responsive";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";
import { Text } from "../ui/Typography";
import { getDefaultPortfolioCurrencyId } from "./PortfolioCreateDialog.helpers";

interface PortfolioCreateDialogProps {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  showTrigger?: boolean;
  onPortfolioCreated?: (portfolioKey: number) => void;
}

interface FormProps {
  currencyId: string;
  name: string;
}

const PortfolioCreateDialog: React.FC<PortfolioCreateDialogProps> = ({
  isOpen,
  setOpen,
  showTrigger = true,
  onPortfolioCreated,
}) => {
  const t = useTranslations();
  const notifyIfRateLimited = useRateLimitToast();
  const posthog = usePostHog();
  const formSchema = z.object({
    name: z.string().min(1, t("portfolio-name-required")),
    currencyId: z.string().min(1, t("invalid-currency")),
  });

  const methods = useForm<FormProps>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      currencyId: "",
    },
  });
  const {
    handleSubmit,
    formState: { isSubmitting },
    reset,
    setValue,
  } = methods;

  const queryClient = useQueryClient();
  const { data: configsData } = useConfigs();
  const { data: accountsData } = useAccounts();

  // Default currency to user's currency (from any account)
  useEffect(() => {
    const userCurrencyCode =
      accountsData?.accounts[0]?.accountOwnerAppuserKey.currencyKey.code;
    const defaultCurrencyId = getDefaultPortfolioCurrencyId(
      configsData?.currencies,
      userCurrencyCode,
    );

    if (defaultCurrencyId) {
      setValue("currencyId", defaultCurrencyId);
    }
  }, [accountsData, configsData, setValue]);

  useEffect(() => () => reset(), [reset]);

  const mutation = useCreatePortfolio();

  const onSubmit = async (data: FormProps) => {
    await mutation.mutateAsync(data, {
      onSuccess: async (res) => {
        const createdPortfolioKey = res.data.portfolio.portfolioKey;
        posthog.capture("portfolio_created");
        await queryClient.invalidateQueries({
          queryKey: ["portfolios"],
          exact: true,
        });
        reset();
        onPortfolioCreated?.(createdPortfolioKey);
        setOpen(false);
      },
      onError: (error) => {
        if (notifyIfRateLimited(error)) return;
        if (isDemoReadOnlyError(error)) {
          toast.error(t("demo-read-only-title"), {
            description: t("demo-read-only-description"),
            duration: 9000,
          });
          return;
        }

        toast.error(t("toast-create-portfolio-error"), { duration: 9000 });
      },
    });
  };

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={setOpen}
      trigger={
        showTrigger ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("create-portfolio")}
          >
            <Plus className="size-4" />
          </Button>
        ) : undefined
      }
      title={t("create-portfolio")}
      footer={
        <Button
          type="submit"
          loading={isSubmitting}
          disabled={isSubmitting}
          form="create-portfolio-form"
        >
          {t("create")}
        </Button>
      }
    >
      <Form {...methods}>
        <FormContent
          onSubmit={handleSubmit(onSubmit)}
          id="create-portfolio-form"
        >
          <FormField
            control={methods.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("name")}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t("portfolio-name-placeholder")}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={methods.control}
            name="currencyId"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel required>{t("currency")}</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={field.disabled}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("select-currency")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {configsData?.currencies.map((currency) => (
                        <SelectItem
                          key={currency.currencyKey}
                          value={currency.currencyKey.toString()}
                        >
                          {getCurrencySymbol(currency.code)}{" "}
                          <Text
                            variant="smallText"
                            className="text-muted-foreground"
                          >
                            {currency.description}
                          </Text>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormContent>
      </Form>
    </DrawerDialog>
  );
};

export default PortfolioCreateDialog;
