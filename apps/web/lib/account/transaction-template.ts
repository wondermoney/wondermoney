import type { TransactionType } from "@/lib/api/account/useTransactionTypes";
import type { TransactionTemplate } from "@/lib/api/transaction-template/useTransactionTemplates";

/**
 * The transaction types that move money out and in, by the API's stored names. A template
 * carries a direction, not a type, so the add form picks a type that agrees with it.
 */
const OUTGOING_TYPE_NAMES = new Set([
  "atm",
  "card_payment",
  "fee",
  "fees",
  "loan",
  "payment",
  "transfer_out",
]);
const INCOMING_TYPE_NAMES = new Set([
  "card_refund",
  "cashback",
  "deposit",
  "reward",
  "topup",
  "transfer_in",
]);

/** The type a direction starts on, most specific first; the first the server offers wins. */
const PREFERRED_OUTGOING = [
  "PAYMENT",
  "CARD_PAYMENT",
  "ATM",
  "FEE",
  "LOAN",
  "TRANSFER_OUT",
];
const PREFERRED_INCOMING = [
  "DEPOSIT",
  "TOPUP",
  "CARD_REFUND",
  "CASHBACK",
  "REWARD",
  "TRANSFER_IN",
];

export function transactionTypeForDirection(
  types: readonly TransactionType[],
  direction: "in" | "out",
): TransactionType | undefined {
  const names = direction === "out" ? OUTGOING_TYPE_NAMES : INCOMING_TYPE_NAMES;
  const preferred = direction === "out" ? PREFERRED_OUTGOING : PREFERRED_INCOMING;
  const matching = types.filter((type) =>
    names.has(type.name.trim().toLowerCase()),
  );
  for (const name of preferred) {
    const found = matching.find(
      (type) => type.name.trim().toUpperCase() === name,
    );
    if (found) return found;
  }
  return matching[0];
}

/** The add-form values a template supplies. Only what it carries; the rest stays as it was. */
export interface TransactionTemplatePrefill {
  accountId?: string;
  categoryId?: string;
  description: string;
  notes: string;
  settlementAmount?: number;
  transactionDate: Date;
  transactionMerchantId?: string;
  transactionMerchantName: string;
  transactionTypeId?: string;
}

/**
 * The add form's values for a template. The date is always today: a template is a shape for a
 * new entry, never a dated one. Choosing a template only fills the form; it creates nothing.
 */
export function transactionTemplatePrefill(
  template: TransactionTemplate,
  types: readonly TransactionType[],
  today = new Date(),
): TransactionTemplatePrefill {
  const type = transactionTypeForDirection(types, template.direction);
  return {
    ...(template.account
      ? { accountId: String(template.account.accountKey) }
      : {}),
    ...(template.category
      ? { categoryId: String(template.category.categoryKey) }
      : {}),
    description: template.description ?? "",
    notes: template.notes ?? "",
    ...(template.amount !== null ? { settlementAmount: template.amount } : {}),
    transactionDate: today,
    ...(template.transactionMerchant
      ? {
          transactionMerchantId: String(
            template.transactionMerchant.transactionMerchantKey,
          ),
        }
      : {}),
    transactionMerchantName: template.transactionMerchant?.name ?? "",
    ...(type ? { transactionTypeId: String(type.transactionTypeKey) } : {}),
  };
}
