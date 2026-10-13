import { CircleHelp } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

import { Link } from "./Link";

type HelpHintProps = {
  href: string;
  children: React.ReactNode;
  className?: string;
  external?: boolean;
};

export function HelpHint({
  href,
  children,
  className,
  external = true,
}: HelpHintProps) {
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer noopener" : undefined}
      className={cn(
        "text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex w-fit items-center gap-1.5 rounded-sm text-xs leading-snug underline-offset-4 transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        className,
      )}
    >
      <CircleHelp aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{children}</span>
    </Link>
  );
}
