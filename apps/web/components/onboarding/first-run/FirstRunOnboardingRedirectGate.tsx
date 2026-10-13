"use client";

import { type ReactNode, useEffect } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";
import useAccounts from "@/lib/api/account/useAccounts";
import { useOnboardingBootstrap } from "@/lib/api/user/useCompleteVersionedOnboarding";
import { useUser } from "@/lib/auth/user-context";
import {
  getFirstRunState,
  getFirstRunStepRoute,
  markFirstRunCompleted,
  shouldShowFirstRunOnboarding,
} from "@/lib/onboarding/firstRunOnboarding";

const FIRST_RUN_PATH = getFirstRunStepRoute("welcome");

function isOnboardingPath(pathname: string) {
  return pathname.includes("/onboarding/") || pathname.endsWith("/onboarding");
}

function isAllowedHandoffPath(pathname: string, activeHandoff?: string) {
  if (activeHandoff === "account") return pathname.includes("/accounts");
  if (activeHandoff === "budget") return pathname.includes("/budgets/wizard");
  if (activeHandoff === "portfolio") return pathname.includes("/portfolio");
  return false;
}

export default function FirstRunOnboardingRedirectGate({
  children,
}: {
  children: ReactNode;
}) {
  const user = useUser();
  const pathname = usePathname();
  const router = useRouter();
  const { data: accountsData, isFetched } = useAccounts();

  // RAD-333. `localStorage` cannot decide this. It is empty on a new browser, a
  // second device, a private window and after clearing site data, so
  // `shouldShowFirstRunOnboarding` returned true for people who had finished
  // months ago. The previous guard tried to compensate by checking whether the
  // user had any accounts, but read that from a query that had not resolved
  // yet: on first mount `isFetched` is false, so the escape hatch was skipped
  // and control fell straight through to the redirect. Once it landed on an
  // onboarding route the `isOnboardingPath` bail-out meant it never recovered,
  // even after the accounts arrived. A fully-onboarded account with data
  // replayed all six steps — reproduced 2026-08-23.
  //
  // The server has always known the answer (`completed` / `required` from
  // `GET /v1/user/me/onboarding`); nothing was asking it. Now it is the
  // authority, `localStorage` is only a fast path to avoid a flash, and no
  // redirect fires off an unresolved query.
  const needsFirstRunLocally = Boolean(
    user?.id && shouldShowFirstRunOnboarding(user.id),
  );
  const { data: bootstrap, isSuccess: bootstrapResolved } =
    useOnboardingBootstrap(needsFirstRunLocally);

  useEffect(() => {
    if (!user?.id) return;

    // localStorage says onboarding is done — nothing to guard, and no request.
    if (!needsFirstRunLocally) return;

    // Server says it is done: reconcile the local flag and stay put. This is
    // the case the old gate got wrong on every fresh client.
    if (bootstrapResolved && bootstrap?.onboarding.completed) {
      markFirstRunCompleted(user.id);
      return;
    }

    // Having accounts also implies a finished first run, and answers sooner
    // than the bootstrap on a warm cache.
    if (isFetched && accountsData?.accounts && accountsData.accounts.length > 0) {
      markFirstRunCompleted(user.id);
      return;
    }

    // Nothing authoritative has come back yet. Waiting costs a beat; guessing
    // costs the user the whole wizard, so wait.
    if (!bootstrapResolved) return;

    if (pathname === FIRST_RUN_PATH || pathname.endsWith(FIRST_RUN_PATH))
      return;
    if (isOnboardingPath(pathname)) return;

    const { activeHandoff } = getFirstRunState(user.id);
    if (isAllowedHandoffPath(pathname, activeHandoff)) return;

    router.replace(FIRST_RUN_PATH);
  }, [
    accountsData,
    bootstrap,
    bootstrapResolved,
    isFetched,
    needsFirstRunLocally,
    pathname,
    router,
    user,
  ]);

  return children;
}
