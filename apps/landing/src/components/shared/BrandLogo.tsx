import { brandMonogram, findBrandLogo, logoSrc } from "@/lib/brandLogos";
import { cn } from "@/lib/utils";

/**
 * A brand's logo at 24 px, set beside its name (never instead of it): the name stays the
 * accessible label, so the mark is decorative. A brand without a logo gets its initials on a quiet
 * tile, so rows stay aligned. The logo tile is white on any theme, so dark marks stay visible.
 * `className` may resize the tile (`size-10 text-sm`): it wins over the defaults.
 */
export default function BrandLogo({ name, className = "" }: { name: string; className?: string }) {
  const entry = findBrandLogo(name);
  const tile = "inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border";
  if (!entry) {
    return (
      <span aria-hidden="true" className={cn(tile, "bg-paper-2 text-[10px] font-semibold leading-none text-ink-2", className)}>
        {brandMonogram(name)}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={cn(tile, "bg-white", className)}>
      <img src={logoSrc(entry.logo)} alt="" width={24} height={24} loading="lazy" decoding="async" className="size-full object-cover" />
    </span>
  );
}
