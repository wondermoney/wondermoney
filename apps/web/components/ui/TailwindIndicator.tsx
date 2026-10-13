import { env } from "@/lib/utils/env";

export function TailwindIndicator() {
  if (env.NODE_ENV === "production") return null;

  return (
    // `bg-foreground text-background` — the inverted-chip pair, and the last
    // hardcoded palette class in the app after the a5639b08 sweep. It was
    // `bg-gray-800 text-white`, which only read as "inverted" on the light
    // canvas: in dark mode a gray-800 chip sat almost flush against the
    // near-black background. The token pair inverts with the theme, so the
    // indicator stays legible in both halves.
    <div className="bg-foreground text-background fixed bottom-1 left-1 z-50 flex size-6 items-center justify-center rounded-full font-mono text-xs">
      <div className="block sm:hidden">xs</div>
      <div className="hidden sm:block md:hidden lg:hidden xl:hidden 2xl:hidden">
        sm
      </div>
      <div className="hidden md:block lg:hidden xl:hidden 2xl:hidden">md</div>
      <div className="hidden lg:block xl:hidden 2xl:hidden">lg</div>
      <div className="hidden xl:block 2xl:hidden">xl</div>
      <div className="hidden 2xl:block">2xl</div>
    </div>
  );
}
