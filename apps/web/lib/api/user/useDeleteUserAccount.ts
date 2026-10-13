import { useMutation } from "@tanstack/react-query";

import api from "../api";

type DeleteUserAccountApiClient = {
  delete: (url: string) => Promise<unknown>;
};

export async function deleteUserAccount(
  apiClient: DeleteUserAccountApiClient = api,
) {
  return apiClient.delete("/v1/user/me");
}

const useDeleteUserAccount = () => {
  return useMutation({
    mutationFn: () => deleteUserAccount(),
  });
};

export default useDeleteUserAccount;
