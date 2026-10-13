import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return <div className="bg-muted min-h-dvh w-screen">{children}</div>;
}
