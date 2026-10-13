"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
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
import { isDemoReadOnlyError } from "@/lib/api/errors";
import type {
  LoanDetail,
  LoanRepayment,
  LoanRepaymentCandidate,
} from "@/lib/api/loan/types";
import useLinkLoanRepayment from "@/lib/api/loan/useLinkLoanRepayment";
import useUpdateLoanRepayment from "@/lib/api/loan/useUpdateLoanRepayment";

const schema = z
  .object({
    total: z.coerce.number().min(0),
    principal: z.coerce.number().min(0),
    interest: z.coerce.number().min(0),
    fees: z.coerce.number().min(0),
  })
  .refine(
    (v) => Math.abs(v.total - (v.principal + v.interest + v.fees)) < 0.01,
    { message: "sum" },
  );

export default function RepaymentAllocationForm({
  loan,
  candidate,
  existingRepayment,
  onDone,
  onBack,
}: {
  loan: LoanDetail;
  candidate: LoanRepaymentCandidate;
  existingRepayment?: LoanRepayment | null;
  onDone: () => void;
  onBack: () => void;
}) {
  const t = useTranslations("loans");
  const tCommon = useTranslations();
  const link = useLinkLoanRepayment();
  const update = useUpdateLoanRepayment();
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      total: existingRepayment?.totalPaymentAmount ?? candidate.amount,
      principal: existingRepayment?.principalAmount ?? candidate.amount,
      interest: existingRepayment?.interestAmount ?? 0,
      fees: existingRepayment?.feeAmount ?? 0,
    },
  });
  useEffect(() => {
    form.reset({
      total: existingRepayment?.totalPaymentAmount ?? candidate.amount,
      principal: existingRepayment?.principalAmount ?? candidate.amount,
      interest: existingRepayment?.interestAmount ?? 0,
      fees: existingRepayment?.feeAmount ?? 0,
    });
  }, [candidate, existingRepayment, form]);
  const submit = async (values: z.infer<typeof schema>) => {
    const payload = {
      transactionKey: candidate.transactionKey,
      totalPaymentAmount: values.total,
      principalAmount: values.principal,
      interestAmount: values.interest,
      feeAmount: values.fees,
    };

    try {
      if (existingRepayment) {
        await update.mutateAsync({
          loanId: loan.loanKey,
          repaymentLinkId: existingRepayment.loanRepaymentLinkKey,
          payload: {
            totalPaymentAmount: values.total,
            principalAmount: values.principal,
            interestAmount: values.interest,
            feeAmount: values.fees,
          },
        });
      } else {
        await link.mutateAsync({ loanId: loan.loanKey, payload });
      }
      onDone();
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(tCommon("demo-read-only-title"), {
          description: tCommon("demo-read-only-description"),
          duration: 9000,
        });
        return;
      }

      toast.error(tCommon("server-error"));
    }
  };
  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack}>
        {t("detail.actions.back")}
      </Button>
      <Form {...form}>
        <FormContent onSubmit={form.handleSubmit(submit)} className="space-y-4">
          <FormField
            control={form.control}
            name="total"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("detail.repayments.totalPayment")}</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-3 gap-3">
            <FormField
              control={form.control}
              name="principal"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("detail.repayments.principal")}</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="interest"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("detail.repayments.interest")}</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="fees"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("detail.repayments.fees")}</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <Button type="submit" loading={link.isPending || update.isPending}>
            {t("detail.repayments.saveAllocation")}
          </Button>
        </FormContent>
      </Form>
    </div>
  );
}
