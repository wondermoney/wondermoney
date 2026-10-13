"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/utils/useMediaQuery";

type Props = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpen?: () => void;
  onClose?: () => void;
  defaultOpen?: boolean;
  trigger?: React.ReactNode;
  triggerLabel?: string;
  title?: string;
  description?: string;
  closable?: boolean;
  contentClassName?: string;
  footer?: React.ReactNode;
  visuallyHiddenHeader?: boolean;
};

export function DrawerDialog({
  open: controlledOpen,
  onOpenChange,
  onOpen,
  onClose,
  defaultOpen = false,
  contentClassName,
  triggerLabel,
  trigger,
  title,
  description,
  footer,
  closable,
  visuallyHiddenHeader = false,
  children,
}: React.PropsWithChildren<Props>) {
  const [open, setOpen] = useControllableState({
    prop: controlledOpen,
    onChange: (newOpen) => {
      onOpenChange?.(newOpen);
      if (newOpen) {
        onOpen?.();
      } else {
        onClose?.();
      }
    },
    defaultProp: defaultOpen,
  });

  const isDesktop = useMediaQuery("(min-width: 768px)");
  const hasHeader = title || description;
  const dialogContentProps = description
    ? {}
    : ({ "aria-describedby": undefined } as const);

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        {trigger ? (
          <DialogTrigger asChild>{trigger}</DialogTrigger>
        ) : triggerLabel ? (
          <DialogTrigger asChild>
            <Button className="h-9 rounded-md px-3 md:h-10 md:px-4 md:py-2">
              {triggerLabel}
            </Button>
          </DialogTrigger>
        ) : null}
        {/* `max-h-[85dvh] overflow-y-auto` is RAD-332: without a height bound on
            the content itself, a tall form pushed its own footer past the bottom
            of the viewport and the submit button was unreachable. The viewport
            wrapper in dialog.tsx was already there when RAD-332 was filed, so it
            is not a substitute — keep both.

            The cost is that this makes DialogContent a scroll container, and a
            popover rendered inside it would be constrained/clipped by it. That
            is paid for by portalling instead: every searchable-select popover
            renders at body level (see components/ui/combobox*.tsx and
            components/CategoryComboBoxForm.tsx), so nothing that can open over
            this dialog lives inside this scroll container.
            scripts/searchable-select-regression-checks.ts holds both ends. */}
        <DialogContent
          className={cn("max-h-[85dvh] overflow-y-auto", contentClassName)}
          {...dialogContentProps}
        >
          {hasHeader && (
            <DialogHeader
              className={visuallyHiddenHeader ? "sr-only" : undefined}
            >
              {title && <DialogTitle>{title}</DialogTitle>}
              {description && (
                <DialogDescription>{description}</DialogDescription>
              )}
            </DialogHeader>
          )}
          {children}
          {footer ? (
            <>
              <DialogFooter>{footer}</DialogFooter>
            </>
          ) : closable ? (
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Close
                </Button>
              </DialogClose>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      ) : triggerLabel ? (
        <DrawerTrigger asChild>
          <Button className="h-9 rounded-md px-3 md:h-10 md:px-4 md:py-2">
            {triggerLabel}
          </Button>
        </DrawerTrigger>
      ) : null}
      <DrawerContent className={contentClassName}>
        {hasHeader && (
          <DrawerHeader
            className={visuallyHiddenHeader ? "sr-only" : "mb-4 text-left"}
          >
            {title && <DrawerTitle>{title}</DrawerTitle>}
            {description && (
              <DrawerDescription>{description}</DrawerDescription>
            )}
          </DrawerHeader>
        )}
        <div className="min-h-0 overflow-y-auto px-4 pb-4 md:px-0">
          {children}
        </div>
        {footer ? (
          <>
            <DrawerFooter>{footer}</DrawerFooter>
          </>
        ) : closable ? (
          <DrawerFooter>
            <DrawerClose asChild>
              <Button type="button" variant="secondary">
                Close
              </Button>
            </DrawerClose>
          </DrawerFooter>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
