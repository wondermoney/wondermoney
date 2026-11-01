"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import React, { useEffect } from "react";
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
  buildDependentsSchema,
  DependentsData,
  useBudgetWizardStore,
} from "../store";

export default function DependentsPage() {
  const t = useTranslations();
  const router = useRouter();
  const [setDependents, dependents, household] = useBudgetWizardStore(
    useShallow((state) => [
      state.setDependents,
      state.dependents,
      state.household,
    ]),
  );

  // Redirect if no household data (eg: if user navigates straight to this page)
  useEffect(() => {
    if (!household) {
      router.replace("/budgets/wizard/household");
    }
  }, [household, router]);

  // Clamp a stale stored value (e.g. the user went back and lowered the
  // household size after already choosing dependents) so the slider never
  // mounts past its own max — this is a fresh `useForm` on every visit to
  // this route, so recomputing from the current store state on mount is
  // enough; no `reset()` needed.
  const initialDependentsNum = household
    ? Math.min(dependents?.dependentsNum ?? 0, household.householdSize)
    : (dependents?.dependentsNum ?? 0);

  const methods = useForm({
    resolver: zodResolver(
      buildDependentsSchema(household, t("dependents-max-household")),
    ),
    defaultValues: {
      dependentsNum: initialDependentsNum,
    },
  });

  const onSubmit: SubmitHandler<DependentsData> = async (data) => {
    setDependents(data);
    router.push("/budgets/wizard/income");
  };

  if (!household) return null;

  return (
    <div>
      {/* The entrance is CSS, not motion/react: a self-running animation
          that leaves the step visible with scripting off or before hydration;
          `motion-safe:` drops it for anyone who asked for reduced motion.
          motion/react rendered every block at opacity 0 into the HTML and
          animated regardless of that setting. */}
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-5 motion-safe:fill-mode-both motion-safe:duration-500">
        <Heading
          variant="h2"
          className="text-center"
          id="dependents-size-label"
        >
          {t("how-many-dependents-do-you-have")}
        </Heading>
      </div>
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-5 motion-safe:fill-mode-both motion-safe:delay-200 motion-safe:duration-500">
        <Text
          variant="mutedText"
          className="text-muted-foreground mx-auto mt-2 w-full max-w-md text-center"
        >
          {t("want-a-budget-that-truly-fits-your-life")}
        </Text>
      </div>
      <Form {...methods}>
        <FormContent
          className="flex w-full flex-col gap-8"
          onSubmit={methods.handleSubmit(onSubmit)}
        >
          <FormField
            control={methods.control}
            name="dependentsNum"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Slider
                    className="mt-12!"
                    min={0}
                    max={household.householdSize}
                    step={1}
                    value={[field.value]}
                    name={field.name}
                    onValueChange={(value) => field.onChange(value[0])}
                    defaultValue={[field.value]}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    aria-labelledby="dependents-size-label"
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
  );
}
