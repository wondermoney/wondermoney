"use client";

import { authClient } from "@/lib/auth/client";

// better-auth's useSession() hook works standalone (it reads from a nanostore
// store, no React context required), so this provider is a passthrough. Kept
// as a component so `app/providers.tsx` keeps a stable provider boundary.
export function AuthUserProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

export function useUser() {
  const { data } = authClient.useSession();
  const user = data?.user;

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    email_confirmed_at: user.emailVerified
      ? new Date(user.createdAt ?? 0).toISOString()
      : null,
  };
}
