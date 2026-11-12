import { useQuery } from "@tanstack/react-query";

import api from "../api";

/**
 * Who PDF statement pages go to, from the signed-in profile (`GET /v1/user/me/profile`), for the
 * consent line. `name` is the company (Anthropic, Azure OpenAI), or null for an OpenAI-compatible
 * endpoint: the server never sends its address, which may be an internal host, so the consent line
 * names it as the AI provider this server is set up with.
 */
export interface StatementImportProvider {
  kind: "anthropic" | "azure-openai" | "openai-compatible";
  name: string | null;
}

interface ProfileResponse {
  profile: {
    aiProviders?: { statementImport?: StatementImportProvider | null };
  };
}

export default function useStatementImportProvider(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ["user", "me", "profile"],
    queryFn: () =>
      api
        .get<ProfileResponse>("/v1/user/me/profile")
        .then(
          (response) =>
            response.data.profile.aiProviders?.statementImport ?? null,
        ),
    staleTime: 5 * 60 * 1000,
  });
}
