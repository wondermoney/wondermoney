import { getTranslations } from "next-intl/server";

import { JoinInviteConfirm } from "@/components/auth/JoinInviteConfirm";
import { ReCaptchaProvider } from "@/components/auth/ReCaptchaProvider";
import SignupForm from "@/components/auth/SignupForm";
import Logo from "@/components/layout/Logo";
import { Link } from "@/components/ui/Link";
import { Text } from "@/components/ui/Typography";
import { validateInvite } from "@/lib/api/household/validateInvite";
import { getServerSession } from "@/lib/auth/server-auth";
import { signInToAcceptHref } from "@/lib/household/join-links";
import { getInstanceName } from "@/lib/instance-name.server";

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

const linkClassName =
  "text-primary font-semibold underline underline-offset-2 hover:decoration-2";

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const t = await getTranslations("household");
  const { locale } = await params;
  const { token } = await searchParams;
  const instanceName = await getInstanceName();

  const [session, invite] = await Promise.all([
    getServerSession(),
    token ? validateInvite(token) : Promise.resolve(null),
  ]);

  // Unknown / used / expired / revoked token.
  if (!token || !invite) {
    return (
      <JoinShell>
        <h1 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
          {t("join.invalidTitle")}
        </h1>
        <Text variant="mutedText" className="mt-2 text-sm leading-6">
          {t("join.invalidBody")}
        </Text>
        <Link
          href={session ? "/" : "/auth/login"}
          className={`${linkClassName} mt-6 inline-block text-sm`}
        >
          {t("join.backToApp", { instanceName })}
        </Link>
      </JoinShell>
    );
  }

  // Signed in: an existing account joins only by confirming here.
  if (session) {
    const email = session.user.email;
    return (
      <JoinShell>
        <JoinInviteConfirm
          token={token}
          locale={locale}
          instanceName={instanceName}
          invitedEmail={invite.email}
          signedInEmail={typeof email === "string" ? email : null}
          householdName={invite.householdName}
          inviterName={invite.inviterName}
          role={invite.role}
        />
      </JoinShell>
    );
  }

  const greeting = invite.inviterName
    ? t("join.greetingNamed", { instanceName, name: invite.inviterName })
    : t("join.greetingGeneric", { instanceName });

  return (
    <JoinShell>
      <h1 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
        {greeting}
      </h1>
      <Text variant="mutedText" className="mt-2 text-sm leading-6">
        {t("join.subtitle")}
      </Text>
      <Text variant="mutedText" className="mt-1 text-xs leading-6">
        {t("join.emailLockedHint", { email: invite.email })}
      </Text>
      <Text variant="mutedText" className="mt-1 text-sm leading-6">
        {t.rich("join.signInToAccept", {
          link: (chunks) => (
            <Link
              href={signInToAcceptHref(locale, token)}
              className={linkClassName}
            >
              {chunks}
            </Link>
          ),
        })}
      </Text>
      <ReCaptchaProvider>
        <SignupForm inviteToken={token} lockedEmail={invite.email} />
      </ReCaptchaProvider>
    </JoinShell>
  );
}
