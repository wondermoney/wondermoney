"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import BankConnectionResultNotice from "@/components/account/BankConnectionResultNotice";
import { usePathname, useRouter } from "@/i18n/navigation";
import {
  type BankConnectionResult,
  bankConnectionReturnHref,
  consumeBankConnectionReturnTarget,
  ENABLE_BANKING_CONNECTION_PARAM,
  parseBankConnectionResult,
} from "@/lib/account/bank-account-sync-return-marker";

/**
 * Finishes the bank-connection round trip on the Settings page, where the
 * API's Enable Banking callback always lands
 * (`?enableBankingConnection=success|error`).
 *
 * When the connection was started somewhere else (onboarding, Accounts, a
 * budget) the user is sent back there with the result, whether it succeeded
 * or failed: that page is where they can carry on or try again. Otherwise the
 * result is shown here. Either way the flag leaves the URL, so a refresh does
 * not replay it.
 */
export default function BankConnectionReturn() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [notice, setNotice] = useState<BankConnectionResult | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || !searchParams.has(ENABLE_BANKING_CONNECTION_PARAM)) {
      return;
    }
    handled.current = true;

    const result = parseBankConnectionResult(
      searchParams.get(ENABLE_BANKING_CONNECTION_PARAM),
    );
    // Consumed whatever the result, so a stale marker cannot redirect a
    // later, unrelated return.
    const target = consumeBankConnectionReturnTarget();

    if (result && target) {
      router.replace(
        bankConnectionReturnHref(target, result),
        target.locale ? { locale: target.locale } : undefined,
      );
      return;
    }

    // The marker lives in session storage, so it can only be read after
    // mount; the notice is set here for that reason.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setNotice(result);
    const remaining = new URLSearchParams(searchParams.toString());
    remaining.delete(ENABLE_BANKING_CONNECTION_PARAM);
    const query = remaining.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [pathname, router, searchParams]);

  return notice ? (
    <div className="mb-4">
      <BankConnectionResultNotice result={notice} />
    </div>
  ) : null;
}
