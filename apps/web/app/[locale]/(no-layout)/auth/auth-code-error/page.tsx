import { useTranslations } from "next-intl";

import Logo from "@/components/layout/Logo";
import { Link } from "@/components/ui/Link";

export default function AuthCodeErrorPage() {
  const t = useTranslations();

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <div>
          <Logo />
          <h2 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
            {t("auth-code-error-title")}
          </h2>
          <p className="text-muted-foreground mt-3 text-sm leading-6">
            {t("auth-code-error-description")}
          </p>
          <p className="text-muted-foreground mt-3 text-sm leading-6">
            {t("auth-code-error-cookie-instructions")}
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-3 text-sm leading-6">
          <Link
            href="/auth/login"
            className="text-primary hover:text-primary/80 font-semibold underline underline-offset-2"
          >
            {t("auth-code-error-back-to-login")}
          </Link>
          <Link
            href="/auth/signup"
            className="text-primary hover:text-primary/80 font-semibold underline underline-offset-2"
          >
            {t("auth-code-error-create-account")}
          </Link>
        </div>
      </div>
    </div>
  );
}
