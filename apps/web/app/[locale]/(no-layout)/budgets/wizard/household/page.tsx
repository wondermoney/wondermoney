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
import { Slider } from "@/components/ui/slider";
import { Heading } from "@/components/ui/Typography";
import Text from "@/components/ui/Typography/Text";
import { useRouter } from "@/i18n/navigation";

import {
  type HouseholdData,
  householdSchema,
  useBudgetWizardStore,
} from "../store";

export default function HouseholdPage() {
  const t = useTranslations();
  const router = useRouter();
  const [setHousehold, household] = useBudgetWizardStore(
    useShallow((state) => [state.setHousehold, state.household]),
  );

  const methods = useForm({
    resolver: zodResolver(householdSchema),
    defaultValues: household || {
      householdSize: 2,
    },
  });

  const onSubmit: SubmitHandler<HouseholdData> = async (data) => {
    setHousehold(data);
    router.push("/budgets/wizard/dependents");
  };

  return (
    <div>
      {/* The entrance is CSS, not motion/react: a self-running animation
          that leaves the step visible with scripting off or before hydration;
          `motion-safe:` drops it for anyone who asked for reduced motion.
          motion/react rendered every block at opacity 0 into the HTML and
          animated regardless of that setting. */}
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-5 motion-safe:fill-mode-both motion-safe:duration-500">
        <Heading variant="h2" className="text-center" id="household-size-label">
          {t("household-composition")}
        </Heading>
      </div>
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-5 motion-safe:fill-mode-both motion-safe:delay-200 motion-safe:duration-500">
        <Text
          variant="mutedText"
          className="text-muted-foreground mx-auto mt-2 w-full max-w-md text-center"
        >
          {t("household-composition-description")}
        </Text>
      </div>
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-5 motion-safe:fill-mode-both motion-safe:delay-400 motion-safe:duration-500">
        <Form {...methods}>
          <FormContent
            className="flex w-full flex-col gap-8"
            onSubmit={methods.handleSubmit(onSubmit)}
          >
            <FormField
              control={methods.control}
              name="householdSize"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Slider
                      className="mt-12!"
                      min={1}
                      max={10}
                      step={1}
                      value={[field.value]}
                      name={field.name}
                      onValueChange={(value) => field.onChange(value[0])}
                      defaultValue={[field.value]}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      aria-labelledby="household-size-label"
                    />
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
