import { useMutation, useQueryClient } from "@tanstack/react-query";

import { invalidateAccounts } from "@/lib/utils/queryInvalidation";

import api from "../api";

const useCreateOfflineAccount = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      name,
      currentBalance,
      currencyId,
      financialInstitutionId,
      accountTypeId,
    }: {
      name: string;
      currentBalance: number;
      currencyId: string;
      financialInstitutionId?: number;
      accountTypeId?: number;
    }) =>
      api.post(`/v1/account/offline`, {
        name,
        currentBalance,
        currencyId,
        financialInstitutionId,
        accountTypeId,
      }),
    // The new account changes every account-derived read, so the write owns
    // the refresh instead of leaving it to each caller. Otherwise the
    // dashboard after onboarding renders the empty state from the
    // `["accounts"]` entry the full-layout gate cached before the redirect
    // into onboarding.
    //
    // Nothing observes `["accounts"]` while the wizard is open, so invalidating
    // only marks it stale, and the dashboard would paint that stale empty list
    // until its own refetch landed. Refetching the inactive list here means the
    // next screen opens on the account that was just created. React Query
    // awaits this before the caller's own `onSuccess`, so a caller that
    // navigates from there navigates on fresh data.
    onSuccess: async () => {
      await Promise.all([
        invalidateAccounts(queryClient),
        queryClient.refetchQueries({ queryKey: ["accounts"], type: "inactive" }),
      ]);
    },
  });
};

export default useCreateOfflineAccount;
