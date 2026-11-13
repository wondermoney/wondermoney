"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import React from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import { useShallow } from "zustand/react/shallow";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormContent,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/Form";
import { Heading } from "@/components/ui/Typography";
import Text from "@/components/ui/Typography/Text";
import { useRouter } from "@/i18n/navigation";
import { BUDGET_VISIBILITIES } from "@/lib/budget/visibility";
import { cn } from "@/lib/utils";

import {
  useBudgetWizardStore,
  type VisibilityData,
  visibilitySchema,
} from "../store";

/**
 * The wizard's first decision: a household budget everyone in the household
 * sees, or a personal one only its creator sees. Asked first, and on its own
 * screen, because the budget can never change it afterwards.
 */
export default function VisibilityPage() {
  const t = useTranslations();
  const router = useRouter();
  const [setVisibility, visibility] = useBudgetWizardStore(
    useShallow((state) => [state.setVisibility, state.visibility]),
  );

  const methods = useForm({
    resolver: zodResolver(visibilitySchema),
    defaultValues: { visibility },
  });

  const onSubmit: SubmitHandler<VisibilityData> = async (data) => {
    setVisibility(data.visibility);
    router.push("/budgets/wizard/household");
  };

  return (
    <div>
      {/* The same CSS entrance as the other steps (see household/page.tsx). */}
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-5 motion-safe:fill-mode-both motion-safe:duration-500">
        <Heading
          variant="h2"
          className="text-center"
          id="budget-visibility-label"
        >
          {t("budgetVisibility.wizard-title")}
        </Heading>
      </div>
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-5 motion-safe:fill-mode-both motion-safe:delay-200 motion-safe:duration-500">
        <Text
          variant="mutedText"
          className="text-muted-foreground mx-auto mt-2 w-full max-w-md text-center"
        >
          {t("budgetVisibility.wizard-description")}
        </Text>
      </div>
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-5 motion-safe:fill-mode-both motion-safe:delay-400 motion-safe:duration-500">
        <Form {...methods}>
          <FormContent
            className="mt-8 flex w-full flex-col gap-8"
            onSubmit={methods.handleSubmit(onSubmit)}
          >
            <FormField
              control={methods.control}
              name="visibility"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <fieldset aria-labelledby="budget-visibility-label">
                      <ul className="divide-border divide-y rounded-md border">
                        {BUDGET_VISIBILITIES.map((option) => {
                          const checked = field.value === option;
                          return (
                            <li key={option}>
                              <label
                                className={cn(
                                  "hover:bg-accent flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3",
                                  checked && "bg-primary/10",
                                )}
                              >
                                <input
                                  type="radio"
                                  name={field.name}
                                  value={option}
                                  checked={checked}
                                  onChange={() => field.onChange(option)}
                                  onBlur={field.onBlur}
                                  className="accent-primary mt-1 size-4 shrink-0"
                                />
                                <span className="flex min-w-0 flex-col gap-1">
                                  <span className="text-foreground font-medium">
                                    {t(`budgetVisibility.${option}`)}
                                  </span>
                                  <span className="text-muted-foreground text-sm">
                                    {t(
                                      `budgetVisibility.${option}-description`,
                                    )}
                                  </span>
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </fieldset>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-center">
              <Button
                type="submit"
                loading={methods.formState.isSubmitting}
                disabled={methods.formState.isSubmitting}
              >
                {t("continue")}
              </Button>
            </div>
          </FormContent>
        </Form>
      </div>
    </div>
  );
}
