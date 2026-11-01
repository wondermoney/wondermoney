import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface AccountEditRequest {
  accountKey: string | number;
  accountName: string;
  // Only the account owner may set this; omit it otherwise so the
  // API's owner-guard isn't tripped when a member merely renames a shared account.
  isPrivate?: boolean;
}

const useEditAccount = () => {
  return useMutation({
    mutationFn: ({ accountKey, accountName, isPrivate }: AccountEditRequest) =>
      api.patch(`/v1/account/${accountKey}`, {
        accountName,
        ...(isPrivate === undefined ? {} : { isPrivate }),
      }),
  });
};

export default useEditAccount;
