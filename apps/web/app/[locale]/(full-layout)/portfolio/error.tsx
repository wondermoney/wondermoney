"use client";

import { useEffect } from "react";

import { AppErrorState } from "@/components/error/AppErrorState";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <AppErrorState error={error} reset={reset} section="portfolio" />;
}
