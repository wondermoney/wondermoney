import { useTranslations } from "next-intl";

import type { Tag } from "@/lib/api/tag/useTags";
import { cn } from "@/lib/utils";

/**
 * A tag as a small chip: the name in foreground ink on the neutral `muted`
 * surface, with the tag's own colour as a dot.
 *
 * The colour is never the chip's background or text. A tag colour is any hex a
 * person picked, so as a fill it would fail contrast in one theme or the other
 * (a pale yellow on white, a navy on the dark canvas). As a dot beside text
 * that always meets contrast, it identifies the tag without carrying it.
 */
export function TagChip({
  tag,
  className,
}: {
  tag: Pick<Tag, "color" | "name">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "border-border bg-muted text-foreground inline-flex h-5 max-w-[16ch] min-w-0 items-center gap-1 rounded-full border px-2 text-xs font-normal",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="ring-foreground/20 size-2 shrink-0 rounded-full ring-1"
        style={{ backgroundColor: tag.color }}
      />
      <span className="truncate">{tag.name}</span>
    </span>
  );
}

/**
 * A row of tag chips. Past `max` the rest collapse into "+N", so a heavily
 * tagged transaction cannot push a table row onto three lines.
 */
export function TagChipList({
  tags,
  max = 3,
  className,
}: {
  tags: readonly Pick<Tag, "color" | "name" | "tagKey">[] | undefined;
  max?: number;
  className?: string;
}) {
  const t = useTranslations("transactionTags");
  if (!tags || tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const hidden = tags.length - shown.length;
  return (
    <span
      className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}
      aria-label={t("list-label", {
        names: tags.map((tag) => tag.name).join(", "),
      })}
      role="list"
    >
      {shown.map((tag) => (
        <span key={tag.tagKey} role="listitem" className="min-w-0">
          <TagChip tag={tag} />
        </span>
      ))}
      {hidden > 0 ? (
        <span role="listitem" className="text-muted-foreground text-xs">
          {t("more", { count: hidden })}
        </span>
      ) : null}
    </span>
  );
}
