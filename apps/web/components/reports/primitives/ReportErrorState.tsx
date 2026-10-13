import { type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RateLimitedState } from "@/components/ui/RateLimitedState";
import { isRateLimitError } from "@/lib/api/rate-limit";
import { cn } from "@/lib/utils";

interface ReportErrorStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  retryLabel: string;
  onRetry: () => void;
  className?: string;
  /**
   * The query error. The reports route fans out into one request per report,
   * so a shared 429 would otherwise turn every card on the page into an error.
   * Passing it degrades this card, and only this card, to the calm state.
   */
  error?: unknown;
}

export function ReportErrorState({
  icon: Icon,
  title,
  description,
  retryLabel,
  onRetry,
  className,
  error,
}: ReportErrorStateProps) {
  if (isRateLimitError(error)) {
    return (
      <RateLimitedState
        variant="inline"
        error={error}
        onRetry={onRetry}
        className={className}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      <Icon className="text-muted-foreground size-10" strokeWidth={1.5} />
      <div className="flex max-w-xs flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <Button variant="outline" size="sm" className="mt-1" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}
