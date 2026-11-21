import type { Ref } from "react";

import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LAYER } from "@/lib/layers";

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
      className={`fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] ${LAYER.consent} gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-lg md:right-6 md:bottom-6`}
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
      className={`fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] ${LAYER.consent} w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg md:right-6 md:bottom-6 md:w-96`}
      aria-label={title}
    >
      {/* The message takes the card's full width, the button under it: beside the button the long locales fold into four short lines */}
      <div className="flex flex-col items-start gap-3">
        <p role="status" className="text-sm leading-6 text-muted-foreground">
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
