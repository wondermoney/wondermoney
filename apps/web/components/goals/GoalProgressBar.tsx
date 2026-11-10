export default function GoalProgressBar({ value }: { value: number }) {
  const width = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));

  return (
    <div
      className="bg-border h-2 overflow-hidden rounded-sm"
      aria-hidden="true"
    >
      {/* Fills to 100% and slides in on translateX rather than animating
          `width`. Animating width lays out on every frame; transform is
          composited. Same mechanism as components/ui/progress.tsx. */}
      <div
        className="bg-chart-1 h-full rounded-sm transition-transform duration-[var(--duration-short)] ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(-${100 - width}%)` }}
      />
    </div>
  );
}
