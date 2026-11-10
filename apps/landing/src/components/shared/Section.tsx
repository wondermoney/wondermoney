import type { PropsWithChildren } from "react";
import { Container } from "./Container";
import { cn } from "@/lib/utils";

interface Props extends React.HTMLProps<HTMLDivElement> {
  preTitle?: string;
  title?: string;
  subTitle?: string;
}

export default function Section({
  preTitle,
  title,
  subTitle,
  children,
  className,
  ...rest
}: PropsWithChildren<Props>) {
  return (
    <section
      className={cn(
        "px-4 pt-16 pb-16 lg:pt-24 lg:pb-24 xl:px-2 overflow-hidden",
        className
      )}
      {...rest}
    >
      <Container className="flex flex-col gap-12 lg:gap-16 items-center">
        {(title || preTitle || subTitle) && (
          <div className={cn("flex flex-col gap-3 max-w-2xl text-center")}>
            {title && (
              <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {title}
              </h2>
            )}
            {subTitle && (
              <p className="text-lg leading-8 text-muted-foreground mt-3">
                {subTitle}
              </p>
            )}
          </div>
        )}
        {children}
      </Container>
    </section>
  );
}
