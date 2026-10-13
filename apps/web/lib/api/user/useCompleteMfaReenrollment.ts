import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";

// Clears the `requiresMfaReenrollment` flag set on users whose TOTP secret
// wasn't carried over during the Supabase -> better-auth migration, once
// they've completed the re-enrollment flow. Invalidates the user-data query
// so `requiresMfaReenrollment` refetches as `false` and the gate closes.
const useCompleteMfaReenrollment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string | number) =>
      api.post(`/v1/user/${userId}/mfa-reenrollment/complete`),
    onSuccess: (_data, userId) => {
      void queryClient.invalidateQueries({ queryKey: ["user", userId] });
    },
  });
};

export default useCompleteMfaReenrollment;
