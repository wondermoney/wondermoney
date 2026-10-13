"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { SubmitHandler, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import useEditAccount from "@/lib/api/account/useEditAccount";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { Switch } from "../ui/switch";

interface AccountEditSheetProps {
  accountName: string;
  accountKey: number;
  isOpen: boolean;
  isOwnedByViewer: boolean;
  isPrivate: boolean;
  onOpenChange: (open: boolean) => void;
}

const formSchema = z.object({
  accountName: z.string(),
  isPrivate: z.boolean(),
});

type FormSchema = z.infer<typeof formSchema>;

const AccountEditSheet: React.FC<AccountEditSheetProps> = ({
  accountName,
  accountKey,
  isOpen,
  isOwnedByViewer,
  isPrivate,
  onOpenChange,
}) => {
  const t = useTranslations();
  const posthog = usePostHog();
  const methods = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { accountName, isPrivate },
  });
  const {
    handleSubmit,
    formState: { isSubmitting },
  } = methods;
  const editAccountMutation = useEditAccount();
  const qc = useQueryClient();

  const onSubmit: SubmitHandler<FormSchema> = async (data) => {
    posthog.capture("account_edited");
    await editAccountMutation.mutateAsync(
      {
        accountKey,
        accountName: data.accountName,
        // Only the owner may change privacy — omit otherwise so the API's
        // owner-guard doesn't reject a member renaming a shared account.
        isPrivate: isOwnedByViewer ? data.isPrivate : undefined,
      },
      {
        onSettled: async () => {
          await qc.invalidateQueries({ queryKey: ["accounts"], exact: true });
          onOpenChange(false);
        },
        onSuccess: () => toast.success(t("account-updated")),
      },
    );
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t("edit-account")}</SheetTitle>
          <SheetDescription>{t("edit-account-description")}</SheetDescription>
        </SheetHeader>
        <Form {...methods}>
          <form
            className="my-8 w-full"
            onSubmit={handleSubmit(onSubmit)}
            id="edit-account-sheet"
          >
            <FormField
              control={methods.control}
              name="accountName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("name")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("my-account")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {isOwnedByViewer && (
              <FormField
                control={methods.control}
                name="isPrivate"
                render={({ field }) => (
                  <FormItem className="mt-6 flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <FormLabel>{t("private-account")}</FormLabel>
                      <p className="text-muted-foreground text-xs">
                        {t("private-account-description")}
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
            )}
          </form>
        </Form>
        <SheetFooter>
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={isSubmitting}
            form="edit-account-sheet"
          >
            {t("save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default AccountEditSheet;
