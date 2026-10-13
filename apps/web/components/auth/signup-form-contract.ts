import { z } from "zod";

import { env } from "@/lib/utils/env";
import { canBypassRecaptchaForE2E } from "@/lib/utils/recaptcha-e2e-bypass";

export const signupFormSchema = z.object({
  email: z.string().email("Invalid email"),
  inviteToken: z.string().optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type SignupFormSchema = z.infer<typeof signupFormSchema>;

// better-auth's signUp.email requires a non-empty `name`, but the signup
// form only collects email + password. Derive a reasonable default from the
// email's local part — users can rename themselves later in settings.
export function deriveNameFromEmail(email: string): string {
  return email.split("@")[0] || email;
}

export function canBypassRecaptchaClientFailure() {
  return canBypassRecaptchaForE2E({
    appUrl: env.NEXT_PUBLIC_APP_URL,
    bypassFlag: env.NEXT_PUBLIC_E2E_BYPASS_RECAPTCHA,
    vercelEnv: env.NEXT_PUBLIC_VERCEL_ENV,
  });
}
