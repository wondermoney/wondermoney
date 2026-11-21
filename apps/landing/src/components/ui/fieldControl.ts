/**
 * The box every form field draws, shared by `Input` and `Select` so the two cannot drift: 40px
 * tall (the product app's control height), the 6px control radius, the Input Stroke border on
 * the canvas, the instant violet focus ring with a 2px offset, and the error border while the
 * field carries `aria-invalid="true"`. Each component adds its own padding.
 */
export const fieldControlClass =
  "h-10 w-full rounded-md border border-input bg-background text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive-text";
