import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface CreditCardSettingsRequest {
  accountKey: string | number;
  statementCloseDay: number;
  paymentDueDay: number;
  creditLimit?: number | null;
  minimumPaymentPercent?: number | null;
}

export interface CreditCardSettingsResponse {
  creditCard: {
    statementCloseDay: number;
    paymentDueDay: number;
    creditLimit: number | null;
    minimumPaymentPercent: number | null;
  };
}

/**
 * `PUT /v1/account/:accountKey/credit-card`. Upserts the card's cycle and marks the account as a
 * credit card, so the same call both turns an account into a card and edits one.
 */
const useUpdateCreditCard = () => {
  return useMutation({
    mutationFn: async ({
      accountKey,
      statementCloseDay,
      paymentDueDay,
      creditLimit,
      minimumPaymentPercent,
    }: CreditCardSettingsRequest) => {
      const { data } = await api.put<CreditCardSettingsResponse>(
        `/v1/account/${accountKey}/credit-card`,
        {
          statementCloseDay,
          paymentDueDay,
          ...(creditLimit === undefined ? {} : { creditLimit }),
          ...(minimumPaymentPercent === undefined
            ? {}
            : { minimumPaymentPercent }),
        },
      );
      return data;
    },
  });
};

export default useUpdateCreditCard;
