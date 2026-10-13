import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface AccountDeleteRequest {
  accountKey: string | number;
}

const useDeleteAccount = () => {
  return useMutation({
    mutationFn: ({ accountKey }: AccountDeleteRequest) =>
      api.delete(`/v1/account/${accountKey}`),
  });
};

export default useDeleteAccount;
