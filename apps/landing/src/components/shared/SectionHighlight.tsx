import type { PropsWithChildren } from "react";
import { Container } from "./Container";
import { cn } from "@/lib/utils";

interface Props {
  preTitle?: string;
  title: string;
  subTitle?: string;
  children: React.ReactNode;
  className?: string;
}

export default function SectionHighlight({
  preTitle,
  title,
  subTitle,
  children,
  className,
}: PropsWithChildren<Props>) {
  return (
    <section className="bg-transparent md:px-4 pt-12 pb-12 lg:pt-24 lg:pb-24">
      <Container>
        <div
          className={cn(
            "relative isolate overflow-hidden rounded-card border border-border bg-paper-2 px-6 text-center md:rounded-3xl",
            {
              "py-24": !preTitle,
              "pt-16 pb-12 lg:pb-24": preTitle,
            },
            className
          )}
        >
          <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {preTitle && (
              <span className="mb-4 block text-base tracking-normal text-foreground">{preTitle}</span>
            )}{" "}
            {title}
          </h2>
          {subTitle && (
            <p className="mx-auto mt-3 max-w-xl text-lg leading-8 text-muted-foreground">
              {subTitle}
            </p>
          )}
          {children}
        </div>
      </Container>
    </section>
  );
}
