import { useTranslations } from "next-intl";

import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";
import Logo from "@/components/layout/Logo";
import { Link } from "@/components/ui/Link";

export default function ForgotPasswordPage() {
  const t = useTranslations();

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <div>
          <Logo />
          <h1 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
            {t("reset-password")}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            {t("not-a-member")}
            <Link
              href="/auth/signup"
              className="text-primary hover:text-primary/80 ml-1 font-semibold underline underline-offset-2"
            >
              {t("create-account-link")}
            </Link>
          </p>
        </div>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
