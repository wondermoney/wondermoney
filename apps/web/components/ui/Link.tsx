import * as React from "react";

import { Link as Linki18n } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

interface LinkProps {
  href: string | { pathname: string; query: { [key: string]: string } };
  target?: string;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean;
  className?: string;
  rel?: string;
  onClick?: () => void;
}

const Link = React.forwardRef<
  HTMLAnchorElement,
  React.PropsWithChildren<LinkProps>
>(({ children, className, ...props }, ref) => {
  return (
    <Linki18n
      ref={ref}
      // This was a bare pass-through, so every link in the app fell back to the
      // user agent's own focus ring — a different indicator from the one every
      // other primitive draws. The ring is on the base now; a call site can
      // still override it through `className`, which `cn` places last.
      className={cn(
        "ring-offset-background focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden",
        className,
      )}
      {...props}
    >
      {children}
    </Linki18n>
  );
});
Link.displayName = "Link";

export { Link };
