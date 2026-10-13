export default function GoalProgressBar({ value }: { value: number }) {
  const width = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));

  return (
    <div
      className="bg-muted h-2 overflow-hidden rounded-full"
      aria-hidden="true"
    >
      {/* Fills to 100% and slides in on translateX rather than animating
          `width`. Animating width lays out on every frame; transform is
          composited. Same mechanism as components/ui/progress.tsx. */}
      <div
        className="bg-foreground h-full rounded-full transition-transform duration-[var(--duration-short)] ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(-${100 - width}%)` }}
      />
    </div>
  );
}
