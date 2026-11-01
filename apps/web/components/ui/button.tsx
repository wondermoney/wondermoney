import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Press feedback (`active:scale-[0.98]`) is deliberately one primitive applied
  // to every variant rather than a per-variant colour step: `ghost` and `link`
  // have no fill to deepen, and five bespoke pressed colours would drift. The
  // transition names its properties so the scale is actually animated —
  // `transition-colors` alone would snap it.
  // `[&_svg]:shrink-0` is load-bearing and was missing. Without it a flex button
  // that runs short of room squeezes the icon rather than the label: the
  // "Add transaction" CTA on the accounts overview rendered its plus at 4px
  // wide against a 14px height, so only the vertical stroke survived and it
  // read as a stray "·". 27 call sites pass an icon without their own
  // `shrink-0`; fixing the primitive covers all of them and stops it recurring.
  // Deliberately not adding shadcn's `[&_svg]:size-4` — call sites here pick
  // their own sizes (size-3.5 / size-4) and that would override them.
  // `gap-2` belongs on the primitive, not on call sites, so every button spaces
  // its icon from its label the same way. A call site that wants a different
  // gap still wins through `cn`, and a lone icon has nothing to gap against.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[color,background-color,border-color,transform] duration-[var(--duration-micro)] ease-out focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // No `active:bg-*/<alpha>` on the filled variants. Fading a fill toward
        // the canvas *raises* its lightness, which costs the label contrast at
        // exactly the moment the user is interacting: measured, primary at /80
        // lands on 4.31:1 light and 4.21:1 dark, under the 4.5:1 floor. The
        // scale in the base class carries the press instead. Hover stays at /90
        // (5.40 / 5.10), which still clears it.
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // Tinted variants are the exception — the label sits on the canvas, not
        // on the fill, so a deeper tint costs nothing (primary on primary/15
        // measures 5.37 light / 5.63 dark).
        outline:
          "border border-primary bg-background text-primary hover:bg-primary/10 active:bg-primary/15",
        // The border is doing real work, not decoration. `--secondary` and
        // `--muted` are the same value in both halves, so a secondary button
        // measured 1.04:1 against a card and exactly 1.00:1 against any muted
        // surface — as a shape it was invisible and only its label gave it
        // away, against WCAG 1.4.11's 3:1 for a control boundary. The fill is
        // right for what else spends this token (progress tracks, badges,
        // avatar wells), which are meant to be quiet; it is the 45 buttons
        // that needed an edge. `--input` is the control-boundary token and now
        // clears 3:1 on its own.
        secondary:
          "border-input bg-secondary text-secondary-foreground hover:bg-secondary/80 border",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        // `text-primary` rather than `text-primary/80`: a link is body-adjacent
        // text and the 80% wash cost it contrast for no gain. Underline on
        // hover *and* focus so the affordance isn't pointer-only.
        link: "text-primary underline-offset-4 hover:underline focus-visible:underline",
        // `input` is not really a button variant — it is a form-control surface
        // that comboboxes, the date picker and the category pickers render
        // through, and FormControl sets `aria-invalid` on it exactly as it does
        // on a real Input. Without this, a combobox that failed validation
        // looked identical to one that passed: on the Add Transaction form,
        // two of the three invalid fields showed no error at all. It matches
        // input.tsx / Select.tsx so the whole form fails the same way.
        input:
          "border border-input bg-transparent font-normal hover:bg-accent aria-[invalid=true]:border-destructive-text aria-[invalid=true]:focus-visible:ring-destructive-text",
      },
      size: {
        default: "h-10 px-4 py-2",
        xs: "h-8 rounded-md px-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading,
      type,
      children,
      ...props
    },
    ref,
  ) => {
    const classNames = cn(buttonVariants({ variant, size, className }));

    if (asChild) {
      // `disabled` rides through in `props` unchanged rather than being OR-ed
      // with `loading`: asChild is overwhelmingly used to render an anchor, and
      // `disabled` is not a valid attribute on one. `aria-busy` is valid on any
      // element, so the busy state is still announced here.
      return (
        <Slot
          className={classNames}
          ref={ref}
          {...props}
          aria-busy={loading || undefined}
        >
          {children}
        </Slot>
      );
    }

    return (
      <button
        className={classNames}
        ref={ref}
        type={type ?? "button"}
        {...props}
        // After the spread on purpose. A loading button must not stay
        // clickable, or a form could be submitted twice while its first submit
        // is still in flight. `loading` wins over an explicit
        // `disabled={false}`, which is the whole point: a caller cannot
        // re-enable a busy button by accident.
        // `aria-busy` says *why* it is unavailable; a disabled control with no
        // explanation just reads as broken.
        disabled={loading || props.disabled}
        aria-busy={loading || undefined}
      >
        {/* No `mr-2` on the spinner any more — the base `gap-2` already
            separates it from the label, and both together read as 16px. */}
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
