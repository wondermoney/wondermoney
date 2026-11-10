import type { PropsWithChildren } from "react";

interface Props {
  title: string;
  subTitle?: string;
  cta?: React.ReactNode;
}

export default function SectionHero({
  title,
  subTitle,
  cta,
  children,
}: PropsWithChildren<Props>) {
  return (
    <section>
      <div className="py-8 md:pt-16 md:pb-12 lg:pt-32 lg:pb-24 bg-background">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-6xl [text-wrap:balance]">
              {title}
            </h1>
            {subTitle && (
              <p className="mt-4 text-lg leading-8 text-muted-foreground">
                {subTitle}
              </p>
            )}
            {cta && (
              <div className="mt-9 flex items-center justify-center gap-x-6">
                {cta}
              </div>
            )}
          </div>
          {children && <div className="mt-6 md:mt-12 flow-root">{children}</div>}
        </div>
      </div>
    </section>
  );
}
