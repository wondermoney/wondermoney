"use client";

import type { ReactNode } from "react";

import { usePreviewFeatures } from "@/lib/api/preview-features/usePreviewFeatures";

/**
 * Renders its children only when the signed-in user has preview features on.
 *
 * Use it around an entry point (a nav item, a link, a whole page section) that
 * leads to a feature still behind the preview flag. The matching API route is
 * mounted with `requirePreviewFeatures`, so hiding the entry point is not the
 * only protection.
 */
export function PreviewGate({
  children,
  fallback = null,
}: {
  children: ReactNode;
  /** Shown instead of the children when preview features are off. Defaults to nothing. */
  fallback?: ReactNode;
}) {
  const enabled = usePreviewFeatures();
  return enabled ? <>{children}</> : <>{fallback}</>;
}
