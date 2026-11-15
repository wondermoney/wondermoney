"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import LoginForm from "@/components/auth/LoginForm";
import { useInstanceName } from "@/components/instance/InstanceNameProvider";
import Logo from "@/components/layout/Logo";
import { Link } from "@/components/ui/Link";

export default function LoginPage() {
  const t = useTranslations();
  const instanceName = useInstanceName();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  // The marketing site's "Try the demo" link: start the demo session on arrival. A visitor
  // who is already signed in never gets here; the middleware sends them into the app.
  const autoStartDemo = searchParams.get("demo") === "1";

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <div>
          <Logo />
          <h1 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
            {t("sign-in-to-your-account", { instanceName })}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            {t.rich("not-a-member-signup", {
              signupLink: (chunks) => (
                <Link
                  href="/auth/signup"
                  className="text-primary ml-1 font-semibold underline underline-offset-2 hover:decoration-2"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
        <LoginForm autoStartDemo={autoStartDemo} nextParam={nextParam} />
      </div>
    </div>
  );
}
