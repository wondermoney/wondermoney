import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { env } from "@/lib/utils/env";

import { getBetterAuthCookiePrefix } from "./cookie-prefix";

// better-auth's client appends its default `/api/auth` basePath itself
// (see `withPath()` in better-auth/dist/utils/url.mjs), so `baseURL` must be
// the API origin — passing a URL that already includes `/api/auth` here
// would leave requests unaffected (better-auth detects the existing path and
// does not double it), but passing the bare origin is the documented/
// intended usage and is what keeps this in sync with `getApiUrl()` in
// `lib/api/api.ts`.
const API_URL = env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export const authClient = createAuthClient({
  baseURL: API_URL,
  cookiePrefix: getBetterAuthCookiePrefix(API_URL),
  plugins: [twoFactorClient()],
});

export const { signIn, signOut, signUp, useSession } = authClient;
