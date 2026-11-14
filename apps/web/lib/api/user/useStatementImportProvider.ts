import {
  type Profile,
  type StatementImportProvider,
  useProfileField,
} from "./useProfile";

export type { StatementImportProvider };

const selectStatementImportProvider = (
  profile: Profile,
): StatementImportProvider | null =>
  profile.aiProviders?.statementImport ?? null;

/**
 * Who PDF statement pages go to, from the signed-in profile (`GET /v1/user/me/profile`), for the
 * consent line. `name` is the company (Anthropic, Azure OpenAI), or null for an OpenAI-compatible
 * endpoint: the server never sends its address, which may be an internal host, so the consent line
 * names it as the AI provider this server is set up with.
 */
export default function useStatementImportProvider(enabled: boolean) {
  return useProfileField(selectStatementImportProvider, { enabled });
}
