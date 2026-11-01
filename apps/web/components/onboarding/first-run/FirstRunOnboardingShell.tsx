"use client";

import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

import { useInstanceName } from "@/components/instance/InstanceNameProvider";
import { InstanceNameWordmark } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { isDefaultInstanceName } from "@/lib/instance-name";
import { cn } from "@/lib/utils";

type FirstRunOnboardingShellBaseProps = {
  stepIndex: number;
  totalSteps: number;
  stepLabel: string;
  progressLabel: string;
  children: ReactNode;
  footerActions?: ReactNode;
};

type FirstRunOnboardingShellProps = FirstRunOnboardingShellBaseProps &
  (
    | {
        onBack: () => void;
        backLabel: string;
      }
    | {
        onBack?: undefined;
        backLabel?: undefined;
      }
  );

export default function FirstRunOnboardingShell({
  stepIndex,
  totalSteps,
  stepLabel,
  progressLabel,
  children,
  footerActions,
  onBack,
  backLabel,
}: FirstRunOnboardingShellProps) {
  const instanceName = useInstanceName();

  return (
    <main className="bg-background min-h-screen">
      <header className="border-border bg-background fixed inset-x-0 top-0 z-20 border-b">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center px-4 sm:px-6">
          {isDefaultInstanceName(instanceName) ? (
            <Image
              src="/logo.png"
              alt={instanceName}
              width={98}
              height={36}
              priority
              className="h-8 w-auto"
            />
          ) : (
            <InstanceNameWordmark name={instanceName} className="text-xl" />
          )}
        </div>
      </header>

      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 pt-20 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-6">
        <div className="mb-5 shrink-0">
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-0.5 flex-1 transition-colors duration-300",
                  // `bg-muted` sat 1.03:1 on the canvas, so the steps still
                  // to come did not show at all in light mode.
                  i <= stepIndex ? "bg-primary" : "bg-border",
                )}
              />
            ))}
          </div>
          {/* Two facts, two places: the count under the first segment, the
              step's name under the last, instead of one dot-joined string. */}
          <p className="text-muted-foreground mt-2 flex justify-between gap-4 text-xs">
            <span>{progressLabel}</span>
            <span className="text-foreground font-medium">{stepLabel}</span>
          </p>
        </div>

        <div className="flex flex-1 items-start py-5">
          <div className="w-full">{children}</div>
        </div>
      </div>

      <footer className="border-border bg-background fixed inset-x-0 bottom-0 z-20 border-t">
        <div className="mx-auto flex min-h-16 w-full max-w-2xl items-center gap-2 px-4 py-2 sm:px-6">
          {onBack ? (
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              className="text-muted-foreground hover:text-foreground min-h-11 px-3 text-sm font-medium"
            >
              <ArrowLeft className="size-4" />
              {backLabel}
            </Button>
          ) : null}
          <div className="flex-1" />
          {footerActions}
        </div>
      </footer>
    </main>
  );
}
