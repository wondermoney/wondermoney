import type { Ref } from "react";

import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

type CollapsedConsentButtonProps = {
  readonly buttonRef: Ref<HTMLButtonElement>;
  readonly label: string;
  readonly onOpen: () => void;
};

export function CollapsedConsentButton({
  buttonRef,
  label,
  onOpen,
}: CollapsedConsentButtonProps) {
  return (
    <Button
      ref={buttonRef}
      className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-lg md:right-6 md:bottom-6"
      variant="outline"
      onClick={onOpen}
    >
      <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      {label}
    </Button>
  );
}

type SavedConsentStatusProps = {
  readonly buttonRef: Ref<HTMLButtonElement>;
  readonly title: string;
  readonly savedLabel: string;
  readonly choicesLabel: string;
  readonly onOpen: () => void;
};

export function SavedConsentStatus({
  buttonRef,
  title,
  savedLabel,
  choicesLabel,
  onOpen,
}: SavedConsentStatusProps) {
  return (
    <aside
      className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg md:right-6 md:bottom-6 md:w-80"
      aria-label={title}
    >
      <div className="flex items-center justify-between gap-4">
        <p role="status" className="text-sm text-muted-foreground">
          {savedLabel}
        </p>
        <Button
          ref={buttonRef}
          className="min-h-11"
          variant="outline"
          size="sm"
          onClick={onOpen}
        >
          {choicesLabel}
        </Button>
      </div>
    </aside>
  );
}
