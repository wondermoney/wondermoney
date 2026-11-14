import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface AccountEditRequest {
  accountKey: string | number;
  accountName: string;
  // Only the account owner may set this; omit it otherwise so the
  // API's owner-guard isn't tripped when a member merely renames a shared account.
  isPrivate?: boolean;
  // Owner only too (403 `account_owner_required` otherwise): a joint account's spending counts
  // as Shared. Omit it unless the owner is changing it.
  isJoint?: boolean;
}

const useEditAccount = () => {
  return useMutation({
    mutationFn: ({
      accountKey,
      accountName,
      isPrivate,
      isJoint,
    }: AccountEditRequest) =>
      api.patch(`/v1/account/${accountKey}`, {
        accountName,
        ...(isPrivate === undefined ? {} : { isPrivate }),
        ...(isJoint === undefined ? {} : { isJoint }),
      }),
  });
};

export default useEditAccount;
