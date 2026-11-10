import { cn } from "@/lib/utils";

type Props = {
  pattern: "grid" | "dots";
  /** Where the pattern is strongest before it fades out. */
  fade: "top" | "right" | "center";
};

/**
 * A decorative grid or dot field behind a section (classes in globals.css).
 * The section needs `relative isolate`; the layer sits under its content.
 */
export default function BackgroundPattern({ pattern, fade }: Props) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 -z-10",
        pattern === "grid" ? "pattern-grid" : "pattern-dots",
        `pattern-fade-${fade}`,
      )}
    />
  );
}
