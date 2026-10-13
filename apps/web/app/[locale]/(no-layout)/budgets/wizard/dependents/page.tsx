"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
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
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Heading
          variant="h2"
          className="text-center"
          id="dependents-size-label"
        >
          {t("how-many-dependents-do-you-have")}
        </Heading>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <Text
          variant="mutedText"
          className="text-muted-foreground mx-auto mt-2 w-full max-w-md text-center"
        >
          {t("want-a-budget-that-truly-fits-your-life")}
        </Text>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
      ></motion.div>
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
