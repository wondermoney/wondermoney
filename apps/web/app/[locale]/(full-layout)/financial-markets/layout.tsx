import type { ReactNode } from "react";

export default function FinancialMarketsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="flex flex-col gap-4">{children}</div>;
}
