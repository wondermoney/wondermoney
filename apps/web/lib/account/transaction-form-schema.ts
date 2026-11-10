import { z } from "zod";

import { NEW_TRANSACTION_MERCHANT_PREFIX } from "@/lib/account/transaction-merchant";
import { zLocaleNumber, zOptionalLocaleNumber } from "@/lib/utils/number";

/**
 * The add-transaction form, shared by manual entry and OCR confirmation.
 *
 * `hasOriginalAmount` mirrors the "original currency amount" switch. The
 * original-currency inputs are only mounted while it is on, but React Hook
 * Form keeps an unmounted field's last value, so the parsed output drops
 * `originalAmount`, `originalCurrencyId` and `exchangeRate` whenever the
 * switch is off.
 *
 * Amounts are read in the user's `locale` ("1.234,56" in pt and es); an
 * unreadable or blank amount is an `invalid-amount` error, never another number.
 */
export const createTransactionFormSchema = (
  t: (key: string) => string,
  locale: string,
) =>
  z
    .object({
      transactionDate: z.date().default(new Date()),
      transactionTypeId: z.string().min(1, t("invalid-transaction-type")),
      accountId: z.string().min(1, t("invalid-account")),
      notes: z.string().optional(),
      description: z.string(),
      hasOriginalAmount: z.boolean().default(false),
      // The API contract is a positive magnitude plus a separate
      // transactionTypeId for direction, but a YNAB/Monarch-style user
      // naturally types an expense as e.g. "-127.53". Normalize the sign
      // instead of rejecting it — the type field already conveys direction.
      originalAmount: zOptionalLocaleNumber(locale, t("invalid-amount"))
        .optional()
        .transform((val) =>
          val === undefined || val === 0 ? undefined : Math.abs(val),
        ),
      originalCurrencyId: z.string().optional(),
      exchangeRate: zOptionalLocaleNumber(locale, t("invalid-amount"))
        .optional()
        .pipe(z.number().min(0).optional())
        .transform((val) => (val === 0 ? undefined : val)),
      settlementAmount: zLocaleNumber(locale, t("invalid-amount"))
        .transform((val) => Math.abs(val))
        .pipe(z.number().min(0, t("invalid-value"))),
      settlementCurrencyId: z.string().min(1, t("invalid-value")),
      transactionMerchantId: z.string(),
      transactionMerchantName: z.string().trim(),
      categoryId: z.string().optional(),
      tagIds: z.array(z.number().int().positive()).max(50).optional(),
    })
    .refine(
      (data) => {
        if (!data.hasOriginalAmount) {
          return true;
        }
        if (data.originalAmount && !data.originalCurrencyId) {
          return false;
        }
        if (!data.originalAmount && data.originalCurrencyId) {
          return false;
        }
        return true;
      },
      {
        message: t("invalid-original-amount-currency-pair"),
        path: ["originalAmount"],
      },
    )
    .refine(
      (data) => {
        return !!(data.transactionMerchantId || data.transactionMerchantName);
      },
      {
        message: t("invalid-transaction-merchant-required"),
        path: ["transactionMerchantId", "transactionMerchantName"],
      },
    )
    .transform(({ hasOriginalAmount, ...data }) =>
      hasOriginalAmount && data.originalAmount !== undefined
        ? data
        : {
            ...data,
            originalAmount: undefined,
            originalCurrencyId: undefined,
            exchangeRate: undefined,
          },
    );

export type TransactionFormValues = z.infer<
  ReturnType<typeof createTransactionFormSchema>
>;

/**
 * The merchant picker stores either an existing merchant's key or a
 * `[NewMerchant]-<name>` placeholder; the API takes the key as a number and
 * creates a new merchant from `transactionMerchantName` when it is absent.
 */
export const toTransactionRequest = ({
  transactionMerchantId,
  ...values
}: TransactionFormValues) => ({
  ...values,
  transactionMerchantId:
    transactionMerchantId &&
    !transactionMerchantId.startsWith(NEW_TRANSACTION_MERCHANT_PREFIX)
      ? Number(transactionMerchantId)
      : undefined,
});
