"use client";

import { GoogleReCaptchaProvider } from "react-google-recaptcha-v3";

import { env } from "@/lib/utils/env";
import { canBypassRecaptchaForE2E } from "@/lib/utils/recaptcha-e2e-bypass";

interface ReCaptchaProviderProps {
  children: React.ReactNode;
}

export function ReCaptchaProvider({ children }: ReCaptchaProviderProps) {
  const siteKey = env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const bypassRecaptcha = canBypassRecaptchaForE2E({
    appUrl: env.NEXT_PUBLIC_APP_URL,
    bypassFlag: env.NEXT_PUBLIC_E2E_BYPASS_RECAPTCHA,
    vercelEnv: env.NEXT_PUBLIC_VERCEL_ENV,
  });

  if (bypassRecaptcha) {
    return <>{children}</>;
  }

  if (!siteKey) {
    return <>{children}</>;
  }

  return (
    <GoogleReCaptchaProvider
      reCaptchaKey={siteKey}
      scriptProps={{
        async: true,
        defer: true,
        appendTo: "head",
      }}
    >
      {children}
    </GoogleReCaptchaProvider>
  );
}
