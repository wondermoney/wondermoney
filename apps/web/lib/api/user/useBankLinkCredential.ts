import { useInstanceBankSyncCredentials } from "../instance/useInstance";
import useEnableBankingCredential from "./useEnableBankingCredential";
import { type Profile, useProfileField } from "./useProfile";

/**
 * Whether the signed-in person can link a bank right now, and so whether the "add your Enable
 * Banking key" step shows. They can with an active key of their own, or when the server's shared
 * credential covers their household (`bankSyncCredentials` on the profile). Their own key is used
 * whenever they have one.
 */
export interface BankLinkCredential {
  /** A bank can be linked: list banks and start the consent. */
  canLink: boolean;
  /** Neither key is available: show the credential step instead of the bank list. */
  credentialRequired: boolean;
  /** Still finding out. */
  loading: boolean;
  /**
   * The server has a shared credential that does not cover this household (it serves one
   * household), so the credential step says why a key of their own is still needed.
   */
  sharedCredentialUnavailable: boolean;
}

type BankSyncCredentials = "instance" | "user";

export interface BankLinkCredentialInput {
  /** This household's answer from the profile; undefined from an older API or on error. */
  callerCredentials: BankSyncCredentials | undefined;
  callerLoading: boolean;
  /** The server's answer from `GET /v1/instance`. */
  instanceCredentials: BankSyncCredentials | undefined;
  ownCredentialActive: boolean;
  ownCredentialLoading: boolean;
}

export function resolveBankLinkCredential(
  input: BankLinkCredentialInput,
): BankLinkCredential {
  if (input.ownCredentialActive || input.callerCredentials === "instance") {
    return {
      canLink: true,
      credentialRequired: false,
      loading: false,
      sharedCredentialUnavailable: false,
    };
  }
  if (input.ownCredentialLoading || input.callerLoading) {
    return {
      canLink: false,
      credentialRequired: false,
      loading: true,
      sharedCredentialUnavailable: false,
    };
  }
  return {
    canLink: false,
    credentialRequired: true,
    loading: false,
    sharedCredentialUnavailable: input.instanceCredentials === "instance",
  };
}

const selectBankSyncCredentials = (
  profile: Profile,
): BankSyncCredentials => profile.bankSyncCredentials ?? "user";

export default function useBankLinkCredential(): BankLinkCredential {
  const own = useEnableBankingCredential();
  const caller = useProfileField(selectBankSyncCredentials);
  const instanceCredentials = useInstanceBankSyncCredentials();
  return resolveBankLinkCredential({
    callerCredentials: caller.data,
    callerLoading: caller.isLoading,
    instanceCredentials,
    ownCredentialActive: own.data?.status === "active",
    ownCredentialLoading: own.isLoading,
  });
}
