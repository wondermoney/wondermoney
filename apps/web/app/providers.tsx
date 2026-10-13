"use client";

import { ProgressProvider } from "@bprogress/next/app";
import { QueryClientProvider } from "@tanstack/react-query";
// import { setDefaultOptions } from "date-fns";
// import enUS from "date-fns/locale/en-US";
// import pt from "date-fns/locale/pt";
import countries from "i18n-iso-countries";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { Toaster } from "sonner";

import { AnalyticsInit } from "@/components/analytics/AnalyticsInit";
import { SignupCompletionTracker } from "@/components/analytics/SignupCompletionTracker";
import MfaReenrollmentGate from "@/components/settings/Security/MfaReenrollmentGate";
import { ThemeProvider } from "@/components/ThemeProvider";
import { getToastOptions } from "@/components/ui/sonner-options";
import { AuthUserProvider } from "@/lib/auth/user-context";
import { getQueryClient } from "@/lib/query/query-client";
import { isAnalyticsEnabled } from "@/lib/utils/analytics-enabled";

countries.registerLocale(require("i18n-iso-countries/langs/en.json"));

export function Providers(props: { children: React.ReactNode }) {
  // NOTE: Avoid useState when initializing the query client if you don't
  //       have a suspense boundary between this and the code that may
  //       suspend because React will throw away the client on the initial
  //       render if it suspends and there is no boundary
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <PostHogProvider client={posthog}>
        <AuthUserProvider>
          <AnalyticsInit />
          <SignupCompletionTracker analyticsEnabled={isAnalyticsEnabled()} />
          {/* Global, non-dismissible: covers every authenticated route (not
              just (full-layout)) so a flagged user can't reach onboarding,
              wizards, etc. without re-enrolling. Self-hides on anonymous
              routes since useUserData is gated on a logged-in user. */}
          <MfaReenrollmentGate />
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            // defaultTheme="system"
            // enableSystem
            disableTransitionOnChange
          >
            <ProgressProvider
              height="2px"
              color="var(--primary)"
              options={{ showSpinner: false }}
              shallowRouting
            >
              <div className="flex h-dvh flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {props.children}
                </div>
              </div>
            </ProgressProvider>
            <Toaster {...getToastOptions()} />
          </ThemeProvider>
        </AuthUserProvider>
      </PostHogProvider>
    </QueryClientProvider>
  );
}
