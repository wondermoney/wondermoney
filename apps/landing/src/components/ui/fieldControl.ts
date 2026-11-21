/** The box itself: 40px tall, the 6px control radius, the Input Stroke border on the canvas. */
const fieldBoxClass =
  "h-10 w-full rounded-md border border-input bg-background text-sm text-foreground ring-offset-background";

/**
 * The box every form field draws, shared by `Input` and `Select` so the two cannot drift: 40px
 * tall (the product app's control height), the 6px control radius, the Input Stroke border on
 * the canvas, the instant violet focus ring with a 2px offset, and the error border while the
 * field carries `aria-invalid="true"`. Each component adds its own padding.
 */
export const fieldControlClass = `${fieldBoxClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive-text`;

/**
 * The same box drawn by a wrapper around an input and its adornments (`Input` with a `prefix`
 * or `suffix`): each state keys on the input inside it, so the ring, the error border and the
 * dimming are the bare field's.
 */
export const fieldGroupClass = `${fieldBoxClass} has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-2 has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50 has-[[aria-invalid=true]]:border-destructive-text`;
