import { useMutation } from "@tanstack/react-query";

import api from "../api";

const useCreateOfflineAccount = () => {
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
  });
};

export default useCreateOfflineAccount;
