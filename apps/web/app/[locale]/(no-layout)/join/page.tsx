import { getTranslations } from "next-intl/server";

import { JoinLoggedInBlock } from "@/components/auth/JoinLoggedInBlock";
import { ReCaptchaProvider } from "@/components/auth/ReCaptchaProvider";
import SignupForm from "@/components/auth/SignupForm";
import Logo from "@/components/layout/Logo";
import { Link } from "@/components/ui/Link";
import { Text } from "@/components/ui/Typography";
import { validateInvite } from "@/lib/api/household/validateInvite";
import { getServerSession } from "@/lib/auth/server-auth";

function JoinShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <Logo />
        {children}
      </div>
    </div>
  );
}

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const t = await getTranslations("household");
  const { token } = await searchParams;

  const session = await getServerSession();
  const isLoggedIn = Boolean(session);

  // Already signed in → new-signups-only rule: block, offer log-out & create.
  if (isLoggedIn) {
    return (
      <JoinShell>
        <h2 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
          {t("join.loggedInTitle")}
        </h2>
        <Text variant="mutedText" className="mt-2 text-sm leading-6">
          {t("join.loggedInBody")}
        </Text>
        <JoinLoggedInBlock token={token} />
      </JoinShell>
    );
  }

  const invite = token ? await validateInvite(token) : null;

  // Unknown / used / expired / revoked token.
  if (!invite) {
    return (
      <JoinShell>
        <h2 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
          {t("join.invalidTitle")}
        </h2>
        <Text variant="mutedText" className="mt-2 text-sm leading-6">
          {t("join.invalidBody")}
        </Text>
        <Link
          href="/auth/login"
          className="text-primary hover:text-primary/80 mt-6 inline-block text-sm font-semibold underline underline-offset-2"
        >
          {t("join.backToApp")}
        </Link>
      </JoinShell>
    );
  }

  const greeting = invite.inviterName
    ? t("join.greetingNamed", { name: invite.inviterName })
    : t("join.greetingGeneric");

  return (
    <JoinShell>
      <h2 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
        {greeting}
      </h2>
      <Text variant="mutedText" className="mt-2 text-sm leading-6">
        {t("join.subtitle")}
      </Text>
      <Text variant="mutedText" className="mt-1 text-xs leading-6">
        {t("join.emailLockedHint", { email: invite.email })}
      </Text>
      <ReCaptchaProvider>
        <SignupForm inviteToken={token} lockedEmail={invite.email} />
      </ReCaptchaProvider>
    </JoinShell>
  );
}
