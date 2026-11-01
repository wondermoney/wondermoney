import { getTranslations } from "next-intl/server";

import Logo from "@/components/layout/Logo";
import { Link } from "@/components/ui/Link";
import { getInstanceName } from "@/lib/instance-name.server";

// A Server Component: it read the name through `useInstanceName()`, a client
// hook, which threw on the server and left the page a bare "Application error".
// The name comes from the same server read the layout uses.
export default async function AuthCodeErrorPage() {
  const t = await getTranslations();
  const instanceName = await getInstanceName();

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <div>
          <Logo />
          <h1 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
            {t("auth-code-error-title")}
          </h1>
          <p className="text-muted-foreground mt-3 text-sm leading-6">
            {t("auth-code-error-description")}
          </p>
          <p className="text-muted-foreground mt-3 text-sm leading-6">
            {t("auth-code-error-cookie-instructions", { instanceName })}
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-3 text-sm leading-6">
          <Link
            href="/auth/login"
            className="text-primary font-semibold underline underline-offset-2 hover:decoration-2"
          >
            {t("auth-code-error-back-to-login")}
          </Link>
          <Link
            href="/auth/signup"
            className="text-primary font-semibold underline underline-offset-2 hover:decoration-2"
          >
            {t("auth-code-error-create-account")}
          </Link>
        </div>
      </div>
    </div>
  );
}
