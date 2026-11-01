"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";

import {
  BANK_CONNECTION_RESULT_PARAM,
  type BankConnectionResult,
  parseBankConnectionResult,
} from "./bank-account-sync-return-marker";

/**
 * The result of a bank connection this page started, as handed back by the
 * Settings landing (`?bankConnection=success|error`). Read once on mount and
 * then removed from the URL, so a refresh does not replay it.
 */
export function useBankConnectionResult(): BankConnectionResult | null {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [result] = useState(() =>
    parseBankConnectionResult(searchParams.get(BANK_CONNECTION_RESULT_PARAM)),
  );

  useEffect(() => {
    if (!searchParams.has(BANK_CONNECTION_RESULT_PARAM)) return;
    const remaining = new URLSearchParams(searchParams.toString());
    remaining.delete(BANK_CONNECTION_RESULT_PARAM);
    const query = remaining.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  return result;
}
